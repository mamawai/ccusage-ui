// 按天存档 + 从 CC Switch 导入。
//
// 为什么要存档：Claude Code 会删 N 天前的日志（settings.json 的 cleanupPeriodDays，没设是 30 天），删了 ccusage 就读不到，
// "全部""上个月"就少了。所以账本每次完整取完，都和存档合一遍再存回去（存档文件在程序的数据目录，见 Rust 端 archive.rs）。
//
// 合并规则：
// - Claude Code，日志还全的日子（最近 N−1 天）：一律用 ccusage 新取的，存档里的不管（哪怕存档的数更大）
// - Claude Code，更早的日子：日志可能被删了一部分，存档和新取的哪边 token 多用哪边（一样多时用新取的，价格表可能更新过）
// - 别的工具（Codex 等）：它们的日志不会被 Claude Code 删，新取的有这一天就用新取的，存档只补新取的没有的日子
//
// 从 CC Switch 导入：它会把 Claude Code 等工具的日志同步进自己的库，删掉的旧日志它那里还有。按同样的规则补：
// Claude Code 只补日志可能不全的日子，而且 CC Switch 记得比存档多才用；别的工具只补存档里没有的日子。不会重复算。
// 费用用 CC Switch 记下的（ccusage 没有单独算价的办法，CC Switch 也没记 1 小时 / 5 分钟缓存各多少）。
// 导入的 Claude Code 行没有项目，统一记在 "CC Switch" 这个项目名下
import { invoke } from "@tauri-apps/api/core";
import type { AgentBreakdown, AllAgentsRow, ClaudeDailyRow, ModelBreakdown, UsageRow } from "./types";

type Section = "claude" | "agents";

/** 导入的 Claude Code 行记在这个项目名下 */
export const IMPORT_PROJECT = "CC Switch";

async function readArchive<T>(section: Section): Promise<T[]> {
  return (await invoke<T[] | null>("archive_read", { section })) ?? [];
}

/** 和原来存的一样就不写：看别的 Agent 时每分钟都会合一遍，内容基本不变 */
async function writeArchive<T>(section: Section, rows: T[], before: T[]): Promise<void> {
  if (JSON.stringify(rows) === JSON.stringify(before)) return;
  await invoke("archive_write", { section, data: rows });
}

/** Claude Code 的日志从哪天起是全的（YYYY-MM-DD）：保留 N 天的话，N−1 天前的那天起一定没被删 */
async function logsCompleteFrom(): Promise<string> {
  const days = await invoke<number>("claude_log_days");
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * 存档的"读—改—写"一次只做一件：两本账本合并、从 CC Switch 导入可能同时发生，不排队的话后写的会把先写的盖掉。
 * 存档只有大 Dock 这一个窗口在动，这里排队就够了
 */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/** Claude Code 账本完整取完后调用：和存档合并、存回去，返回合并后的行 */
export function archiveClaude(fresh: ClaudeDailyRow[]): Promise<ClaudeDailyRow[]> {
  return exclusive(async () => {
    const [before, logFrom] = await Promise.all([readArchive<ClaudeDailyRow>("claude"), logsCompleteFrom()]);
    const rows = mergeClaude(before, fresh, logFrom);
    await writeArchive("claude", rows, before);
    return rows;
  });
}

/** 全部 Agent 账本取完后调用：同上 */
export function archiveAgents(fresh: AllAgentsRow[]): Promise<AllAgentsRow[]> {
  return exclusive(async () => {
    const [before, logFrom] = await Promise.all([readArchive<AllAgentsRow>("agents"), logsCompleteFrom()]);
    const rows = mergeAgents(before, fresh, logFrom);
    await writeArchive("agents", rows, before);
    return rows;
  });
}

const tokensOf = (rows: { totalTokens: number }[]) => rows.reduce((sum, r) => sum + r.totalTokens, 0);

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/** Claude Code 的日报行（按项目拆开）和存档合并；logFrom 起日志是全的，直接用新取的 */
export function mergeClaude(archive: ClaudeDailyRow[], fresh: ClaudeDailyRow[], logFrom: string): ClaudeDailyRow[] {
  const old = groupBy(archive, (r) => r.date);
  const now = groupBy(fresh, (r) => r.date);
  const out: ClaudeDailyRow[] = [];
  for (const date of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(date) ?? [];
    const f = now.get(date) ?? [];
    out.push(...(date >= logFrom || tokensOf(f) >= tokensOf(a) ? f : a));
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

/** 某一天某个工具用存档的还是新取的：规则见文件开头 */
function keepArchived(agent: string, date: string, archived: AgentBreakdown, fresh: AgentBreakdown | undefined, logFrom: string) {
  if (!fresh) return true;
  if (agent !== "claude") return false;
  return date < logFrom && archived.totalTokens > fresh.totalTokens;
}

/** 全部 Agent 的日报行和存档合并：同一天里每个 Agent 各比各的 */
export function mergeAgents(archive: AllAgentsRow[], fresh: AllAgentsRow[], logFrom: string): AllAgentsRow[] {
  const old = new Map(archive.map((r) => [r.period, r]));
  const now = new Map(fresh.map((r) => [r.period, r]));
  const out: AllAgentsRow[] = [];
  for (const date of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(date);
    const f = now.get(date);
    if (!a || !f) {
      out.push((f ?? a)!);
      continue;
    }
    // 每个 Agent 各挑一份；全挑了新取的就原样用新取的那一行
    let changed = false;
    const agents = new Map((f.agents ?? []).map((x) => [x.agent, x]));
    for (const x of a.agents ?? []) {
      if (keepArchived(x.agent, date, x, agents.get(x.agent), logFrom)) {
        agents.set(x.agent, x);
        changed = true;
      }
    }
    out.push(changed ? rowFromAgents(date, [...agents.values()]) : f);
  }
  return out.sort((x, y) => x.period.localeCompare(y.period));
}

/** 按模型名把几份用量加在一起 */
function sumUsage(parts: UsageRow[]): UsageRow {
  const models = new Map<string, ModelBreakdown>();
  const total: UsageRow = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    modelsUsed: [],
    modelBreakdowns: [],
  };
  for (const p of parts) {
    total.inputTokens += p.inputTokens;
    total.outputTokens += p.outputTokens;
    total.cacheCreationTokens += p.cacheCreationTokens;
    total.cacheReadTokens += p.cacheReadTokens;
    total.totalTokens += p.totalTokens;
    total.totalCost += p.totalCost;
    for (const b of p.modelBreakdowns) {
      const m = models.get(b.modelName);
      if (!m) {
        models.set(b.modelName, { ...b });
        continue;
      }
      m.inputTokens += b.inputTokens;
      m.outputTokens += b.outputTokens;
      m.cacheCreationTokens += b.cacheCreationTokens;
      m.cacheReadTokens += b.cacheReadTokens;
      m.cost += b.cost;
    }
  }
  total.modelBreakdowns = [...models.values()];
  total.modelsUsed = total.modelBreakdowns.map((b) => b.modelName);
  return total;
}

/** 用一天里各 Agent 的用量重新拼出"全部 Agent"的那一行（合计、按模型拆分都重算） */
function rowFromAgents(period: string, agents: AgentBreakdown[]): AllAgentsRow {
  return {
    ...sumUsage(agents),
    period,
    agent: "all",
    agents: [...agents].sort((x, y) => y.totalCost - x.totalCost),
    metadata: { agents: agents.map((a) => a.agent) },
  };
}

// ---------- 从 CC Switch 导入 ----------

/** Rust 端 ccswitch.rs 读出来的：某天、某个工具、某个模型的用量 */
interface SwitchUsage {
  date: string;
  app: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

/** CC Switch 的工具名和 ccusage 的 Agent id 不一样的 */
const AGENT_OF: Record<string, string> = { grokbuild: "grok" };

/** CC Switch 里同一天同一个工具的几行（一个模型一行）拼成一份用量 */
function usageOf(rows: SwitchUsage[]): UsageRow {
  return sumUsage(
    rows.map((r) => {
      const totalTokens = r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;
      const breakdown: ModelBreakdown = {
        modelName: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheCreationTokens: r.cacheCreationTokens,
        cacheReadTokens: r.cacheReadTokens,
        cost: r.cost,
      };
      return { ...breakdown, totalTokens, totalCost: r.cost, modelsUsed: [r.model], modelBreakdowns: [breakdown] };
    }),
  );
}

export interface ImportResult {
  /** 用上了 CC Switch 数据的日子有几天 */
  days: number;
  /** 其中最早的一天 */
  first: string | null;
}

/** 读 CC Switch 的库，补进两份存档。补完要让两本账本重新完整取一次 */
export async function importFromCcSwitch(): Promise<ImportResult> {
  const usage = await invoke<SwitchUsage[]>("ccswitch_read");
  return exclusive(() => importInto(usage));
}

/** 导入的这份要不要用：Claude Code 只补日志可能不全的日子，而且得比存档多；别的工具只补存档里没有的 */
function useImported(agent: string, date: string, imported: number, archived: number | undefined, logFrom: string) {
  if (agent === "claude") return date < logFrom && imported > (archived ?? 0);
  return archived === undefined;
}

async function importInto(usage: SwitchUsage[]): Promise<ImportResult> {
  const [claude, agents, logFrom] = await Promise.all([
    readArchive<ClaudeDailyRow>("claude"),
    readArchive<AllAgentsRow>("agents"),
    logsCompleteFrom(),
  ]);
  // 用上了 CC Switch 数据的日子
  const used = new Set<string>();

  const claudeByDate = groupBy(claude, (r) => r.date);
  for (const [date, rows] of groupBy(usage.filter((u) => u.app === "claude"), (u) => u.date)) {
    const imported: ClaudeDailyRow = { ...usageOf(rows), date, project: IMPORT_PROJECT };
    const archived = claudeByDate.get(date);
    if (useImported("claude", date, imported.totalTokens, archived && tokensOf(archived), logFrom)) {
      claudeByDate.set(date, [imported]);
      used.add(date);
    }
  }

  // 全部 Agent：每天每个工具各比各的
  const agentRows = new Map(agents.map((r) => [r.period, r]));
  for (const [date, rows] of groupBy(usage, (u) => u.date)) {
    const day = new Map((agentRows.get(date)?.agents ?? []).map((a) => [a.agent, a]));
    let changed = false;
    for (const [app, list] of groupBy(rows, (u) => u.app)) {
      const agent = AGENT_OF[app] ?? app;
      const imported: AgentBreakdown = { ...usageOf(list), agent };
      if (useImported(agent, date, imported.totalTokens, day.get(agent)?.totalTokens, logFrom)) {
        day.set(agent, imported);
        changed = true;
        used.add(date);
      }
    }
    if (changed) agentRows.set(date, rowFromAgents(date, [...day.values()]));
  }

  await Promise.all([
    writeArchive("claude", [...claudeByDate.values()].flat().sort((x, y) => x.date.localeCompare(y.date)), claude),
    writeArchive("agents", [...agentRows.values()].sort((x, y) => x.period.localeCompare(y.period)), agents),
  ]);
  return { days: used.size, first: [...used].sort()[0] ?? null };
}
