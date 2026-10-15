// 会话页的数据：会话列表按时间范围交给 ccusage 取（--since 会把跨边界的会话截到范围内），
// 单个会话的逐次调用用 session --id 取。只对 ccusage 给的数字做排序、求和
import { useEffect, useState } from "react";
import { useAgents } from "../../ccusage/agents";
import { allAgents, claudeSession, claudeSessionDetail } from "../../ccusage/api";
import { useLedger } from "../../ccusage/ledger";
import type { AllAgentsRow, ClaudeSessionDetail, ClaudeSessionReport, ClaudeSessionRow } from "../../ccusage/types";
import { parseDay, toArg } from "../../ui/format";
import { OTHER, SERIES } from "../../ui/palette";
import { useNow } from "../../ui/useNow";
import { argToIso, rangeSince, todayIso, type RangeId } from "../overview/data";

/**
 * 缓存的键："时间范围|今天的日期"。过了零点，"今天""7 天"指的日子就变了，要重新取。
 * 组件每分钟重新算一次，零点后一分钟内就换过来
 */
function useListKey(range: RangeId): string {
  useNow(60_000);
  return `${range}|${todayIso()}`;
}

/** 每个时间范围上次取到的列表：切回来先显示它，账本有更新再重新取 */
const lists = new Map<string, { at: number; offline: boolean; report: ClaudeSessionReport }>();

export function useSessions(range: RangeId) {
  const { ledger, offline } = useLedger();
  // 账本刷新了（日志有变化）就说明会话也可能变了
  const version = ledger?.fetchedAt ?? 0;
  const key = useListKey(range);
  const [, setTick] = useState(0);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    const hit = lists.get(key);
    if (hit && hit.at >= version && hit.offline === offline) return;
    let cancelled = false;
    claudeSession({ since: rangeSince(range), offline })
      .then((report) => {
        // 账本连着变了两次时，晚回来的旧请求不能盖掉已经存着的新结果
        const cur = lists.get(key);
        if (!cur || cur.at <= version) lists.set(key, { at: version, offline, report });
        if (!cancelled) {
          setError(undefined);
          setTick((n) => n + 1);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [key, range, version, offline]);

  return { report: lists.get(key)?.report ?? null, error };
}

/**
 * 看过的会话明细，键是"会话|时间范围"。stamp 是列表里这个会话的最后活动时间和 token 数：
 * 没变说明没有新调用，直接用，不再跑 ccusage；切回看过的会话也是秒开。只留最近 30 个
 */
const details = new Map<string, { stamp: string; detail: ClaudeSessionDetail | null }>();
const MAX_DETAILS = 30;
/** 正在读的：同一个会话同时只跑一个 ccusage（预读和点击撞上时共用） */
const loading = new Map<string, { stamp: string; promise: Promise<void> }>();

function stampOf(session: ClaudeSessionRow, offline: boolean): string {
  return `${session.lastActivity}|${session.totalTokens}|${offline}`;
}

function loadDetail(session: ClaudeSessionRow, range: RangeId, offline: boolean): Promise<void> {
  const key = `${session.sessionId}|${range}`;
  const stamp = stampOf(session, offline);
  if (details.get(key)?.stamp === stamp) return Promise.resolve();
  const running = loading.get(key);
  if (running?.stamp === stamp) return running.promise;
  const promise = claudeSessionDetail(session.sessionId, { since: rangeSince(range), offline })
    .then((detail) => {
      // 删了再放，Map 的顺序就是最近用过的在后面；超了就扔最早的
      details.delete(key);
      details.set(key, { stamp, detail });
      if (details.size > MAX_DETAILS) details.delete(details.keys().next().value!);
    })
    .finally(() => {
      if (loading.get(key)?.promise === promise) loading.delete(key);
    });
  loading.set(key, { stamp, promise });
  return promise;
}

/** 鼠标在列表某行上停一会儿就先读着，点下去时多半已经好了 */
export function prefetchSessionDetail(session: ClaudeSessionRow, range: RangeId, offline: boolean) {
  loadDetail(session, range, offline).catch(() => {
    // 预读失败不用管，真点开时会再读一次并显示错误
  });
}

/** 单个会话在这个时间范围里的逐次调用。会话有新调用（列表刷新后 stamp 变了）才重读 */
export function useSessionDetail(session: ClaudeSessionRow | undefined, range: RangeId) {
  const { offline } = useLedger();
  const [, setTick] = useState(0);
  const [error, setError] = useState<unknown>(undefined);
  const key = `${session?.sessionId}|${range}`;
  const stamp = session ? stampOf(session, offline) : "";

  useEffect(() => {
    if (!session) return;
    if (details.get(key)?.stamp === stamp) return;
    let cancelled = false;
    loadDetail(session, range, offline)
      .then(() => {
        if (!cancelled) {
          setError(undefined);
          setTick((n) => n + 1);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
    // session 对象每次列表刷新都是新的，不放进依赖；用 key 和 stamp 判断要不要重读就够了
  }, [key, stamp, range, offline]);

  // 同一个会话有新调用、正在重读时，先用旧的，免得闪
  return { detail: details.get(key)?.detail, error };
}

// ---------- 别的 Agent（ccusage daily --by-agent --sections session）----------

/** 每个时间范围上次取到的全部 Agent 会话，键同 lists */
const agentLists = new Map<string, { at: number; offline: boolean; rows: AllAgentsRow[] }>();

/**
 * 全部 Agent 的会话：ccusage 筛 --since 时拿会话最后活动时间的 UTC 日期去比（ccusage 的 loader.rs 里
 * filter_session_summaries），北京时间凌晨的会话会被算到前一天，凌晨选"今天"就一个都没有。
 * 所以往前多取一天，再按本地时间自己筛：最后活动在范围开始之后的才留下
 */
async function agentSessions(range: RangeId, offline: boolean): Promise<AllAgentsRow[]> {
  const since = rangeSince(range);
  if (!since) return (await allAgents(["session"], { offline })).session ?? [];
  const from = parseDay(argToIso(since));
  const dayBefore = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const report = await allAgents(["session"], { since: toArg(dayBefore), offline });
  // 没有最后活动时间的判断不了，留着
  return (report.session ?? []).filter((r) => {
    const last = r.metadata?.lastActivity;
    return !last || Date.parse(last) >= from.getTime();
  });
}

/** 全部 Agent 的会话列表（含 Claude Code）；别的 Agent 的日志没有监听，跟着全部 Agent 的账本（60 秒一次）刷新 */
export function useAgentSessions(range: RangeId) {
  const { agents, offline } = useAgents();
  const version = agents?.fetchedAt ?? 0;
  const key = useListKey(range);
  const [, setTick] = useState(0);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    const hit = agentLists.get(key);
    if (hit && hit.at >= version && hit.offline === offline) return;
    let cancelled = false;
    agentSessions(range, offline)
      .then((rows) => {
        // 晚回来的旧请求不能盖掉已经存着的新结果
        const cur = agentLists.get(key);
        if (!cur || cur.at <= version) agentLists.set(key, { at: version, offline, rows });
        if (!cancelled) {
          setError(undefined);
          setTick((n) => n + 1);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [key, range, version, offline]);

  return { rows: agentLists.get(key)?.rows ?? null, error };
}

/** 会话 ID 取短的：里面有 UUID 就取它的前 8 位（Codex 的 ID 是带日期的文件路径），否则取最后一段 */
export function shortSessionId(id: string): string {
  const uuid = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  if (uuid) return uuid[0].slice(0, 8);
  return id.split("/").pop() ?? id;
}

/** 按所有会话里各模型的费用从高到低配色，和概览页一个规则；超出配色数量的用"其他"的灰 */
export function modelColors(sessions: { modelBreakdowns: ClaudeSessionRow["modelBreakdowns"] }[]): Map<string, string> {
  const cost = new Map<string, number>();
  for (const s of sessions) {
    for (const b of s.modelBreakdowns) cost.set(b.modelName, (cost.get(b.modelName) ?? 0) + b.cost);
  }
  const names = [...cost.keys()].sort((a, b) => (cost.get(b) ?? 0) - (cost.get(a) ?? 0));
  const keep = names.length <= SERIES.length ? names.length : SERIES.length - 1;
  return new Map(names.map((name, i) => [name, i < keep ? SERIES[i] : OTHER]));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
