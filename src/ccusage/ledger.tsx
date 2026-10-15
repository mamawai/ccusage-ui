// 账本：从 ccusage 取一份全部历史，界面上切时间范围、粒度都只在账本里翻，不再跑 ccusage。
// 完整取完会和按天存档合一遍（见 archive.ts）：Claude Code 删掉 30 天前的日志后，那几天的数还在。
//
// 什么时候重新取：
// - 完整取（全部历史）：启动时、每 30 分钟、点刷新按钮、改了价格来源
// - 增量取（只取昨天和今天，合并进账本）：Rust 端发现日志有变化时（等写入停 1.5 秒、两次至少隔 5 秒都由 Rust 端把关，
//   这里收到事件就取；大 Dock 收到托盘后网页定时器会被节流，所以这里不用定时器等）
// - 更新 ccusage 期间不用管：Rust 端会让报表排队等更新完再跑；更新完设置页会点一次刷新
//
// 谁来取：小 Dock（LedgerWorker）。它一直开着；大 Dock 收到托盘时整个窗口会关掉省内存，不能指望它。
// 取完写进 localStorage，连同"正在取 / 出错 / 价格核对"的状态；大 Dock（LedgerMirror）只读这些，点刷新时发事件叫小 Dock 取
//
// 价格（设置里选"联网核对"时）：完整取时联网，同时用 ccusage 内置价格再算一遍。两边完全一样，增量取才用内置价格（不联网）；
// 不一样（内置价格表过时了）就每次都联网，保证和在终端里直接跑 ccusage 的结果一致。选"内置价格"就一律不联网
import { emitTo, listen } from "@tauri-apps/api/event";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../settings";
import { toArg } from "../ui/format";
import { claudeBlocks, claudeDailyByProject } from "./api";
import { archiveClaude } from "./archive";
import { nonSubscriptionSpend, type Spend } from "./plans";
import type { Block, ClaudeDailyReport, ClaudeDailyRow, ClaudeProjectsReport } from "./types";

const FULL_EVERY_MS = 30 * 60_000;
const CACHE_KEY = "ccusage-ui.ledger.v1";
/** 小 Dock 取数的状态（正在取、出错、价格核对），大 Dock 照着显示 */
const STATUS_KEY = "ccusage-ui.ledger.status.v1";
/** 大 Dock 点刷新：叫小 Dock 完整取一次 */
const REFRESH_EVENT = "ledger-refresh";
/** Rust 端 usage_watch.rs 发出的事件 */
export const USAGE_CHANGED = "usage-changed";

export interface Ledger {
  /** 全部历史的日报行，按项目拆开（每行有 project） */
  rows: ClaudeDailyRow[];
  /** 有用量但找不到价格的模型 */
  unpricedModels: string[];
  /** 5 小时计费块 */
  blocks: Block[];
  /** 按小时的块，从 7 天前的零点起 */
  hours: Block[];
  /** 认出来的非订阅会话（API key、中转）每小时花了多少，估订阅额度时剔除（见 plans.ts）；完整取时算。旧缓存里没有 */
  nonSubscription?: Spend[];
  fetchedAt: number;
}

/** unknown：还没核对过；same：内置价格和联网一样；differ：不一样，每次都联网；builtin：设置里选了只用内置价格 */
export type PriceCheck = "unknown" | "same" | "differ" | "builtin";

interface LedgerState {
  ledger: Ledger | null;
  /** 最近一次取数失败的原因；之后成功了就清掉 */
  error: unknown;
  fetching: boolean;
  prices: PriceCheck;
  /** 别的页面单独跑 ccusage 时要不要加 --offline：核对过价格一致、或者设置里只用内置价格时才不联网 */
  offline: boolean;
  /** 点刷新按钮：完整取一次，并重新核对价格 */
  refresh: () => void;
}

const LedgerContext = createContext<LedgerState | null>(null);

export function dayIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** --instances 的输出按项目分组；一个项目都没有时 ccusage 给的是普通日报，两种都摊平成行 */
function flatten(report: ClaudeProjectsReport | ClaudeDailyReport): ClaudeDailyRow[] {
  if ("projects" in report) {
    return Object.entries(report.projects).flatMap(([project, rows]) => rows.map((r) => ({ ...r, project })));
  }
  return report.daily;
}

/** 核对价格用的一行：哪天、多少 token、多少钱 */
interface PriceRow {
  date: string;
  totalTokens: number;
  totalCost: number;
}

/**
 * 联网价格和 ccusage 内置价格算出来的钱一样不一样。两遍是各自扫日志的，联网那遍要先下价格表，大约晚 1 秒才扫；
 * 中间 Claude Code 正好写进新回复的话两边 token 就对不上，拿总金额比会误判成"不一样"。
 * 所以按天比，只比两边 token 一样的日子；一天都比不了（每天都在变）就是 unknown，等下次完整刷新再核对
 */
export function comparePrices(online: PriceRow[], builtin: PriceRow[]): PriceCheck {
  const byDay = (rows: PriceRow[]) => {
    const days = new Map<string, { tokens: number; cost: number }>();
    for (const r of rows) {
      const d = days.get(r.date) ?? { tokens: 0, cost: 0 };
      d.tokens += r.totalTokens;
      d.cost += r.totalCost;
      days.set(r.date, d);
    }
    return days;
  };
  const b = byDay(builtin);
  let compared = 0;
  for (const [date, x] of byDay(online)) {
    const y = b.get(date);
    if (!y || y.tokens !== x.tokens) continue;
    if (Math.abs(x.cost - y.cost) >= 1e-6) return "differ";
    compared++;
  }
  return compared ? "same" : "unknown";
}

/** 读存在 localStorage 里的账本：小 Dock 启动时先用它，大 Dock 一直读它 */
function readLedgerCache(): Ledger | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  // 缓存格式对不上（比如升级后）就当没有
  try {
    return JSON.parse(raw) as Ledger;
  } catch {
    return null;
  }
}

/** 取数的状态：小 Dock 写，大 Dock 读 */
export interface FetchStatus {
  error: unknown;
  fetching: boolean;
  prices: PriceCheck;
}

/** 读小 Dock 存的取数状态（key 是 STATUS_KEY 那样的键）；没有就是"没在取、没出错、没核对过" */
export function readStatus(key: string): FetchStatus {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<FetchStatus> | null;
    return { error: saved?.error, fetching: !!saved?.fetching, prices: saved?.prices ?? "unknown" };
  } catch {
    return { error: undefined, fetching: false, prices: "unknown" };
  }
}

/** 存取数状态。前端自己的 Error 转 JSON 会变成 {}，先换成文字 */
export function saveStatus(key: string, status: FetchStatus) {
  const error = status.error instanceof Error ? status.error.message : status.error;
  localStorage.setItem(key, JSON.stringify({ ...status, error }));
}

/**
 * 大 Dock 用：只读小 Dock 取好的账本和取数状态，跟着 storage 事件更新；点刷新时发事件叫小 Dock 完整取一次。
 * 对页面来说和取数端一样，都是 useLedger()
 */
export function LedgerMirror({ children }: { children: ReactNode }) {
  const [ledger, setLedger] = useState<Ledger | null>(readLedgerCache);
  const [status, setStatus] = useState<FetchStatus>(() => readStatus(STATUS_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CACHE_KEY) setLedger(readLedgerCache());
      if (e.key === STATUS_KEY) setStatus(readStatus(STATUS_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const refresh = useCallback(() => void emitTo("dock", REFRESH_EVENT), []);
  const offline = status.prices === "same" || status.prices === "builtin";
  const value = useMemo(() => ({ ledger, ...status, offline, refresh }), [ledger, status, offline, refresh]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

/**
 * 小 Dock 用：真正取账本的那个，取完写进 localStorage 给大 Dock 看。
 * enabled 为 false（还没找到 ccusage）时不取，只给缓存里的
 */
export function LedgerWorker({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { settings } = useSettings();
  const [ledger, setLedger] = useState<Ledger | null>(readLedgerCache);
  const [error, setError] = useState<unknown>(undefined);
  const [fetching, setFetching] = useState(false);
  const [prices, setPrices] = useState<PriceCheck>("unknown");

  // 调度用的状态放 ref：回调里要读到最新值，又不需要触发重渲染
  const ledgerRef = useRef(ledger);
  const pricesRef = useRef(prices);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const running = useRef(false);
  const queued = useRef<"full" | "quick" | null>(null);

  const run = useCallback(async (kind: "full" | "quick") => {
    // 正在取就排队，取完再来一次；完整取优先
    if (running.current) {
      if (queued.current !== "full") queued.current = kind;
      return;
    }
    // 没有账本时增量取没有意义
    const mode = kind === "quick" && ledgerRef.current ? "quick" : "full";
    const { priceSource } = settingsRef.current;
    running.current = true;
    setFetching(true);
    try {
      let next: Ledger;
      if (mode === "full") {
        let check: PriceCheck = "builtin";
        let report: ClaudeProjectsReport | ClaudeDailyReport;
        let blocks: Awaited<ReturnType<typeof fetchBlocks>>;
        if (priceSource === "builtin") {
          [report, blocks] = await Promise.all([claudeDailyByProject({ offline: true }), fetchBlocks(true)]);
        } else {
          const [online, builtin, onlineBlocks] = await Promise.all([
            claudeDailyByProject({}),
            claudeDailyByProject({ offline: true }),
            fetchBlocks(false),
          ]);
          check = comparePrices(flatten(online), flatten(builtin));
          report = online;
          blocks = onlineBlocks;
        }
        pricesRef.current = check;
        setPrices(check);
        const fresh = flatten(report);
        next = {
          // 和按天存档合一遍：Claude Code 删掉的旧日志，那几天的数从存档里来。
          // 存档读写出问题（文件坏了之类）不能连累刷新：直接用新取的
          rows: await archiveClaude(fresh).catch(() => fresh),
          unpricedModels: report.totals.unpricedModels ?? [],
          ...blocks,
          // 非订阅会话的花费（一个都没认出来就不多跑 ccusage）；算不出来也不连累刷新，用上次的
          nonSubscription: await nonSubscriptionSpend({ offline: check !== "differ" && check !== "unknown" }).catch(
            () => ledgerRef.current?.nonSubscription ?? [],
          ),
          fetchedAt: Date.now(),
        };
      } else {
        // 只取昨天和今天（昨天也取，跨过零点时不会漏）；更早的日子日志不会再变
        const offline = pricesRef.current === "same" || pricesRef.current === "builtin";
        const since = daysAgo(1);
        const [recent, blocks] = await Promise.all([
          claudeDailyByProject({ since: toArg(since), offline }),
          fetchBlocks(offline),
        ]);
        const sinceIso = dayIso(since);
        const prev = ledgerRef.current!;
        next = {
          rows: [...prev.rows.filter((r) => r.date < sinceIso), ...flatten(recent)],
          unpricedModels: [...new Set([...prev.unpricedModels, ...(recent.totals.unpricedModels ?? [])])],
          ...blocks,
          // 非订阅会话的花费只在完整取时算（要逐个会话取明细），这里沿用
          nonSubscription: prev.nonSubscription,
          fetchedAt: Date.now(),
        };
      }
      ledgerRef.current = next;
      setLedger(next);
      setError(undefined);
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setFetching(false);
      const again = queued.current;
      queued.current = null;
      if (again) void run(again);
    }
  }, []);

  // 找到 ccusage 时、改了价格来源时，完整取一次
  useEffect(() => {
    if (enabled) void run("full");
  }, [enabled, run, settings.priceSource]);

  useEffect(() => {
    if (!enabled) return;
    const quick = listen(USAGE_CHANGED, () => void run("quick"));
    const asked = listen(REFRESH_EVENT, () => void run("full"));
    const every = window.setInterval(() => void run("full"), FULL_EVERY_MS);
    return () => {
      quick.then((stop) => stop());
      asked.then((stop) => stop());
      window.clearInterval(every);
    };
  }, [enabled, run]);

  // 取数状态存起来给大 Dock 看
  useEffect(() => {
    saveStatus(STATUS_KEY, { error, fetching, prices });
  }, [error, fetching, prices]);

  const refresh = useCallback(() => void run("full"), [run]);

  const offline = prices === "same" || prices === "builtin";
  const value = useMemo(
    () => ({ ledger, error, fetching, prices, offline, refresh }),
    [ledger, error, fetching, prices, offline, refresh],
  );
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

/** 取 5 小时块和最近几天的小时块（这两个 ccusage 每次都要扫全部日志，没法只取最近） */
async function fetchBlocks(offline: boolean) {
  const [blocks, hours] = await Promise.all([
    claudeBlocks({}, { offline }),
    // 从 7 天前的零点起：图表最多看 7 天；官方 7 天限额的窗口最早是 7 天前的这个钟点开始的，算它花了多少也够用
    claudeBlocks({ sessionLength: 1 }, { since: toArg(daysAgo(7)), offline }),
  ]);
  return { blocks: blocks.blocks, hours: hours.blocks };
}

export function useLedger(): LedgerState {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger 必须在 LedgerProvider 里面用");
  return ctx;
}
