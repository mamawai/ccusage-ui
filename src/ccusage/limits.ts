// 官方的 5h / 7 天用量限额：Claude Code 刷新状态栏时给的（只有 Pro / Max 订阅有），Rust 端存成文件（见 limits.rs）。
// 文件就是缓存：不用 Claude Code 的时候没有新数据，一直显示最后读到的那次，倒计时照走。从没读到过才不显示。
// 过了重置时间、还没有新数据时按"0% · 已重置"显示，一直到下一次读到为止：那段时间没在订阅上用过，新窗口还没开始，用量确实是 0
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { subscriptionSpent, type Spend } from "./plans";
import type { Block } from "./types";

export interface LimitWindow {
  /** 用了百分之几，0–100 */
  usedPercentage: number;
  /** 几点重置，Unix 秒 */
  resetsAt: number;
}

/** 现在的限额：reset 为 true 表示已经过了重置时间、新窗口的数据还没到，用量按 0 算 */
export interface LiveLimit extends LimitWindow {
  reset: boolean;
}

/** Rust 端存的：哪个窗口没有就是 null */
interface Saved {
  fiveHour: LimitWindow | null;
  sevenDay: LimitWindow | null;
}

/** 现在要显示的限额 */
export interface Limits {
  fiveHour?: LiveLimit;
  sevenDay?: LiveLimit;
}

/** 接入 Claude Code 状态栏的情况 */
export interface HookStatus {
  connected: boolean;
  /** 用户原来的状态栏命令，接入后由我们代为运行；原来没有就是 null */
  original: string | null;
}

/** Rust 端发的：状态栏存的数据（限额、生成速度）变了 */
export const STATUSLINE_CHANGED = "statusline-changed";
const FIVE_HOURS_MS = 5 * 3_600_000;
export const SEVEN_DAYS_MS = 7 * 86_400_000;

/** 存的窗口在 now 这一刻怎么显示 */
function liveOf(w: LimitWindow | null | undefined, now: number): LiveLimit | undefined {
  if (!w) return undefined;
  if (now < w.resetsAt * 1000) return { ...w, reset: false };
  return { ...w, usedPercentage: 0, reset: true };
}

/** 现在的官方限额。now 由调用方给，倒计时跟着走 */
export function useOfficialLimits(now: number): Limits {
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    const read = () => void invoke<Saved | null>("limits_read").then(setSaved);
    read();
    const stop = listen(STATUSLINE_CHANGED, read);
    return () => {
      stop.then((f) => f());
    };
  }, []);
  return {
    fiveHour: liveOf(saved?.fiveHour, now),
    sevenDay: liveOf(saved?.sevenDay, now),
  };
}

/**
 * 接入或断开 Claude Code 的状态栏，跟着设置走；返回现在的情况。Rust 端是幂等的，重复调没关系。
 * enabled 为 null 表示用户还没决定（第一次打开时会问），这时什么都不动
 */
export function useLimitsHook(enabled: boolean | null): { status: HookStatus | null; error: string | null } {
  const [state, setState] = useState<{ status: HookStatus | null; error: string | null }>({ status: null, error: null });
  useEffect(() => {
    if (enabled === null) return;
    invoke<HookStatus>("limits_hook", { enabled }).then(
      (status) => setState({ status, error: null }),
      (e: unknown) => setState({ status: null, error: String(e) }),
    );
  }, [enabled]);
  return state;
}

/** 离重置还有多少分钟 */
export function minutesLeft(w: LimitWindow, now: number): number {
  return Math.max(0, (w.resetsAt * 1000 - now) / 60_000);
}

/** 5h 窗口过了多少（0–1）：窗口从重置时间往前推 5 小时开始 */
export function fiveHourElapsed(w: LimitWindow, now: number): number {
  return Math.min(1, Math.max(0, 1 - (w.resetsAt * 1000 - now) / FIVE_HOURS_MS));
}

/** 5h 窗口的开始时间（ISO），重置时间往前推 5 小时 */
export function fiveHourStart(w: LimitWindow): string {
  return new Date(w.resetsAt * 1000 - FIVE_HOURS_MS).toISOString();
}

/** 重置时间（ISO） */
export function resetIso(w: LimitWindow): string {
  return new Date(w.resetsAt * 1000).toISOString();
}

/**
 * 过去几轮 7 天窗口结束时的百分比，按重置时间从早到晚。Rust 端在状态栏那边看到换轮时记下的，
 * 所以只有接入状态栏以后的轮次才有
 */
export function useWeekHistory(): LimitWindow[] {
  const [history, setHistory] = useState<LimitWindow[]>([]);
  useEffect(() => {
    const read = () => void invoke<LimitWindow[]>("limits_history").then(setHistory);
    read();
    const stop = listen(STATUSLINE_CHANGED, read);
    return () => {
      stop.then((f) => f());
    };
  }, []);
  return history;
}

/** 用量低于这个百分比时不估 7 天额度：百分比是取整的，分母太小估出来能差一倍 */
export const BUDGET_MIN_PERCENT = 5;
const HOUR_MS = 3_600_000;

/** 官方 7 天额度估出来的结果：spent 是这一轮订阅花的（已经剔除了 excluded），budget 是整个额度约多少美元 */
export interface WeekBudget {
  spent: number;
  excluded: number;
  budget: number;
}

/**
 * 官方 7 天额度大约值多少美元：这一轮 7 天窗口（重置时间往前推 7 天）开始到现在订阅花的钱 ÷ 现在的百分比。
 * 花的钱用 Claude Code 按小时的块算，窗口开始那个小时按落在窗口里的比例算；认出来的非订阅会话（API key、中转）
 * 不占官方额度，花的钱剔除（见 plans.ts）。按 API 价格算，只是个模糊的数。
 * 刚重置、用量太少时估不准，返回 null
 */
export function sevenDayBudget(w: LiveLimit, hours: Block[], nonSubscription: Spend[] | undefined): WeekBudget | null {
  if (w.reset || w.usedPercentage < BUDGET_MIN_PERCENT) return null;
  const start = w.resetsAt * 1000 - SEVEN_DAYS_MS;
  const { spent, excluded } = subscriptionSpent(spentSince(start, hours), nonSubscription, start);
  return { spent, excluded, budget: spent / (w.usedPercentage / 100) };
}

/** 从 start（毫秒）到现在花了多少：用 Claude Code 按小时的块算，start 所在那个小时按落在里面的比例算 */
export function spentSince(start: number, hours: Block[]): number {
  let spent = 0;
  for (const b of hours) {
    if (b.isGap) continue;
    const from = Date.parse(b.startTime);
    const inside = (from + HOUR_MS - Math.max(from, start)) / HOUR_MS;
    if (inside > 0) spent += b.costUSD * Math.min(1, inside);
  }
  return spent;
}
