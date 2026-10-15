// 非订阅会话（API key、中转）花的钱：估订阅额度值多少钱时剔除，别的会话都当订阅算。
// 哪些会话不是订阅，由 Rust 端在状态栏那边认（见 plans.rs：Claude Code 只在订阅会话里给状态栏传限额，
// 有回复却没带限额的就是非订阅）。这里把这些会话最近五周每小时花了多少算出来，跟账本存在一起（小 Dock 完整取账本时算）
import { invoke } from "@tauri-apps/api/core";
import { claudeSession, claudeSessionDetail, type ReportOptions } from "./api";
import type { ClaudeSessionEntry } from "./types";

/** 某个小时（开始时刻，毫秒）花了多少 */
export interface Spend {
  at: number;
  cost: number;
}

const HOUR_MS = 3_600_000;
/** 只看最近这么久有活动的会话：5h 窗口页最多往前看五轮 7 天 */
const LOOKBACK_MS = 36 * 86_400_000;

/**
 * 一次调用占整个会话花费的权重：按 Claude 各类 token 的价格比例（输入 1、输出 5、写缓存 1.25、读缓存 0.1）。
 * ccusage 的会话明细里每次调用没有单独的费用，只有整个会话的，按这个比例分下去
 */
function weight(e: ClaudeSessionEntry): number {
  return e.inputTokens + 5 * e.outputTokens + 1.25 * e.cacheCreationTokens + 0.1 * e.cacheReadTokens;
}

/** 认出来的非订阅会话，最近五周每小时花了多少；一个都没认出来就不跑 ccusage，直接是空的 */
export async function nonSubscriptionSpend(opts: ReportOptions): Promise<Spend[]> {
  const ids = new Set(await invoke<string[]>("non_subscription_sessions"));
  if (!ids.size) return [];
  const since = Date.now() - LOOKBACK_MS;
  const { sessions } = await claudeSession(opts);
  const wanted = sessions.filter((s) => ids.has(s.sessionId) && Date.parse(s.lastActivity) >= since);
  const details = await Promise.all(wanted.map((s) => claudeSessionDetail(s.sessionId, opts)));
  const hours = new Map<number, number>();
  for (const d of details) {
    const total = d?.entries.reduce((s, e) => s + weight(e), 0) ?? 0;
    if (!d || total <= 0) continue;
    for (const e of d.entries) {
      const at = Math.floor(Date.parse(e.timestamp) / HOUR_MS) * HOUR_MS;
      hours.set(at, (hours.get(at) ?? 0) + (d.totalCost * weight(e)) / total);
    }
  }
  return [...hours].map(([at, cost]) => ({ at, cost }));
}

/** [from, to) 里花了多少：按小时的桶，两头那个小时按落在里面的比例算 */
export function spentIn(spend: Spend[], from: number, to = Infinity): number {
  let sum = 0;
  for (const s of spend) {
    const inside = Math.min(s.at + HOUR_MS, to) - Math.max(s.at, from);
    if (inside > 0) sum += s.cost * Math.min(1, inside / HOUR_MS);
  }
  return sum;
}

/** 一段时间里订阅花了多少：总花费剔除非订阅会话的（excluded 是剔除了多少） */
export function subscriptionSpent(
  all: number,
  nonSubscription: Spend[] | undefined,
  from: number,
  to = Infinity,
): { spent: number; excluded: number } {
  const excluded = Math.min(all, spentIn(nonSubscription ?? [], from, to));
  return { spent: all - excluded, excluded };
}
