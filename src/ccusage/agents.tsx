// 全部 Agent 的账本：ccusage daily --by-agent 取全部历史的日报（每天一行，行里按 Agent 拆开），
// 切时间范围、切 Agent 都只在本地翻。取完和按天存档合一遍（见 archive.ts），日志删了的日子还在。
//
// 什么时候取：
// - 启动几秒后取一次（让 Claude Code 的账本先取；范围菜单也要靠它列出本机有哪些 Agent）
// - 统计范围不是 Claude Code 时每 60 秒取一次：别的 Agent 的日志没有监听，只能定时取
// - 打开范围菜单时，数据超过 5 分钟就取一次
// - 价格和 Claude Code 账本同一个规则：第一次、每 30 分钟、点刷新时联网核对，和内置价格一样平时就不联网
//
// 和 Claude Code 账本一样由小 Dock 取（AgentsWorker），大 Dock 只读（AgentsMirror），点刷新、打开范围菜单时发事件叫小 Dock 取
import { emitTo, listen } from "@tauri-apps/api/event";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../settings";
import { allAgents } from "./api";
import { archiveAgents } from "./archive";
import { comparePrices, readStatus, saveStatus, type FetchStatus, type PriceCheck } from "./ledger";
import type { AllAgentsReport, AllAgentsRow } from "./types";

const CACHE_KEY = "ccusage-ui.agents.v1";
/** 小 Dock 取数的状态，大 Dock 照着显示 */
const STATUS_KEY = "ccusage-ui.agents.status.v1";
/** 大 Dock 点刷新：叫小 Dock 取一次并核对价格 */
const REFRESH_EVENT = "agents-refresh";
/** 大 Dock 打开范围菜单：数据旧了就叫小 Dock 取一次 */
const TOUCH_EVENT = "agents-touch";
const START_DELAY_MS = 4_000;
const POLL_MS = 60_000;
const STALE_MS = 5 * 60_000;
const CHECK_EVERY_MS = 30 * 60_000;

export interface AgentsLedger {
  /** 全部历史的日报：period 是日期，agents 里是每个 Agent 当天的用量 */
  rows: AllAgentsRow[];
  unpricedModels: string[];
  fetchedAt: number;
}

interface AgentsState {
  agents: AgentsLedger | null;
  error: unknown;
  fetching: boolean;
  prices: PriceCheck;
  /** 别处单独跑 ccusage --by-agent 时要不要加 --offline */
  offline: boolean;
  /** 点刷新按钮：取一次并重新核对价格 */
  refresh: () => void;
  /** 打开范围菜单时调用：数据太旧就取一次 */
  touch: () => void;
}

const AgentsContext = createContext<AgentsState | null>(null);

/** 读存在 localStorage 里的全部 Agent 账本：小 Dock 启动时先用它，大 Dock 一直读它 */
function readAgentsCache(): AgentsLedger | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AgentsLedger;
  } catch {
    return null;
  }
}

// Agent 的显示名，照 ccusage 自己表格里的叫法（Claude 叫 Claude Code，和统计范围的说法一致）；不认识的直接显示 id
const NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  amp: "Amp",
  droid: "Droid",
  codebuff: "Codebuff",
  hermes: "Hermes",
  pi: "pi-agent",
  goose: "Goose",
  openclaw: "OpenClaw",
  kilo: "Kilo",
  copilot: "GitHub Copilot CLI",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
  kimi: "Kimi",
  qwen: "Qwen",
  grok: "Grok",
  zcode: "ZCode",
};

export function agentName(id: string): string {
  return NAMES[id] ?? id;
}

/** 统计范围的显示名：Claude Code、全部 Agent，或者某个 Agent 的名字 */
export function scopeLabel(scope: string, t: (key: "scope.claude" | "scope.all") => string): string {
  if (scope === "claude") return t("scope.claude");
  if (scope === "all") return t("scope.all");
  return agentName(scope);
}

/** 大 Dock 用：只读小 Dock 取好的全部 Agent 账本和取数状态；刷新、打开范围菜单时发事件叫小 Dock 取 */
export function AgentsMirror({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentsLedger | null>(readAgentsCache);
  const [status, setStatus] = useState<FetchStatus>(() => readStatus(STATUS_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CACHE_KEY) setAgents(readAgentsCache());
      if (e.key === STATUS_KEY) setStatus(readStatus(STATUS_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const refresh = useCallback(() => void emitTo("dock", REFRESH_EVENT), []);
  const touch = useCallback(() => void emitTo("dock", TOUCH_EVENT), []);
  const offline = status.prices === "same" || status.prices === "builtin";
  const value = useMemo(
    () => ({ agents, ...status, offline, refresh, touch }),
    [agents, status, offline, refresh, touch],
  );
  return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
}

/**
 * 小 Dock 用：真正取全部 Agent 账本的那个，取完写进 localStorage 给大 Dock 看。
 * scope 是现在的统计范围（不是 Claude Code 时要定时取）；enabled 为 false（还没找到 ccusage）时不取
 */
export function AgentsWorker({ scope, enabled, children }: { scope: string; enabled: boolean; children: ReactNode }) {
  const { settings } = useSettings();
  const [agents, setAgents] = useState<AgentsLedger | null>(readAgentsCache);
  const [error, setError] = useState<unknown>(undefined);
  const [fetching, setFetching] = useState(false);
  const [prices, setPrices] = useState<PriceCheck>("unknown");

  const agentsRef = useRef(agents);
  const pricesRef = useRef(prices);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const running = useRef(false);
  const queued = useRef<boolean | null>(null);
  const lastCheck = useRef(0);

  /** check 为 true 时联网核对价格 */
  const run = useCallback(async (check: boolean) => {
    if (running.current) {
      queued.current = queued.current || check;
      return;
    }
    running.current = true;
    setFetching(true);
    try {
      let report: AllAgentsReport;
      let state = pricesRef.current;
      if (settingsRef.current.priceSource === "builtin") {
        report = await allAgents(["daily"], { offline: true });
        state = "builtin";
        lastCheck.current = Date.now();
      } else if (check || state === "unknown" || state === "builtin") {
        const [online, builtin] = await Promise.all([allAgents(["daily"], {}), allAgents(["daily"], { offline: true })]);
        // 按天比，只比两边 token 一样的日子（见 comparePrices）
        const rows = (r: AllAgentsReport) => (r.daily ?? []).map((d) => ({ ...d, date: d.period }));
        state = comparePrices(rows(online), rows(builtin));
        report = online;
        lastCheck.current = Date.now();
      } else {
        report = await allAgents(["daily"], { offline: state === "same" });
      }
      pricesRef.current = state;
      setPrices(state);
      const fresh = report.daily ?? [];
      const next: AgentsLedger = {
        // 和按天存档合一遍，日志删了的日子从存档里来；存档出问题不能连累刷新，直接用新取的
        rows: await archiveAgents(fresh).catch(() => fresh),
        unpricedModels: report.totals.unpricedModels ?? [],
        fetchedAt: Date.now(),
      };
      agentsRef.current = next;
      setAgents(next);
      setError(undefined);
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setFetching(false);
      const again = queued.current;
      queued.current = null;
      if (again !== null) void run(again);
    }
  }, []);

  // 找到 ccusage 后等一会儿再取，别和 Claude Code 账本抢（一启动就在看别的 Agent 时，下面的定时取已经取过了）
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      if (lastCheck.current === 0 && !running.current) void run(true);
    }, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, run]);

  // 改了价格来源，马上重新取
  const lastSource = useRef(settings.priceSource);
  useEffect(() => {
    if (lastSource.current === settings.priceSource) return;
    lastSource.current = settings.priceSource;
    if (enabled) void run(true);
  }, [enabled, run, settings.priceSource]);

  // 看的不是 Claude Code：切过来时数据旧了就马上取，之后每 60 秒取一次，每 30 分钟顺便核对价格
  useEffect(() => {
    if (!enabled || scope === "claude") return;
    const tick = () => {
      const age = Date.now() - (agentsRef.current?.fetchedAt ?? 0);
      if (age >= POLL_MS - 1_000) void run(Date.now() - lastCheck.current >= CHECK_EVERY_MS);
    };
    tick();
    const every = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(every);
  }, [enabled, scope, run]);

  const refresh = useCallback(() => void run(true), [run]);
  const touch = useCallback(() => {
    if (Date.now() - (agentsRef.current?.fetchedAt ?? 0) > STALE_MS) void run(false);
  }, [run]);

  // 大 Dock 发来的：点了刷新、打开了范围菜单
  useEffect(() => {
    if (!enabled) return;
    const asked = listen(REFRESH_EVENT, refresh);
    const touched = listen(TOUCH_EVENT, touch);
    return () => {
      asked.then((stop) => stop());
      touched.then((stop) => stop());
    };
  }, [enabled, refresh, touch]);

  // 取数状态存起来给大 Dock 看
  useEffect(() => {
    saveStatus(STATUS_KEY, { error, fetching, prices });
  }, [error, fetching, prices]);

  const offline = prices === "same" || prices === "builtin";
  const value = useMemo(
    () => ({ agents, error, fetching, prices, offline, refresh, touch }),
    [agents, error, fetching, prices, offline, refresh, touch],
  );
  return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
}

export function useAgents(): AgentsState {
  const ctx = useContext(AgentsContext);
  if (!ctx) throw new Error("useAgents 必须在 AgentsProvider 里面用");
  return ctx;
}

/** 账本里出现过的 Agent，按全部历史的费用从高到低 */
export function agentList(rows: AllAgentsRow[]): { id: string; cost: number }[] {
  const cost = new Map<string, number>();
  for (const r of rows) for (const a of r.agents ?? []) cost.set(a.agent, (cost.get(a.agent) ?? 0) + a.totalCost);
  return [...cost.entries()].map(([id, c]) => ({ id, cost: c })).sort((a, b) => b.cost - a.cost);
}
