// 概览页的数据整理：只对 ccusage 给的数字做分组、求和，不重新计算费用
import type { AllAgentsRow, Block, ClaudeDailyRow, TokenCounts } from "../../ccusage/types";
import { parseDay, toArg } from "../../ui/format";
import { OTHER, SERIES } from "../../ui/palette";

export type RangeId = "today" | "7d" | "30d" | "month" | "all";
export type Gran = "hour" | "day" | "week" | "month";
export type Metric = "cost" | "tokens";

/** 每种时间范围能选哪些粒度：今天只按小时，7 天可按小时或天，范围越长越粗 */
export const GRANS: Record<RangeId, Gran[]> = {
  today: ["hour"],
  "7d": ["hour", "day"],
  "30d": ["day", "week"],
  month: ["day", "week"],
  all: ["day", "week", "month"],
};

/** 没有按小时的数据（别的 Agent）时去掉"时"，今天就只剩按天 */
export function gransFor(range: RangeId, hasHours: boolean): Gran[] {
  if (hasHours) return GRANS[range];
  const grans = GRANS[range].filter((g) => g !== "hour");
  return grans.length > 0 ? grans : ["day"];
}

export function defaultGran(range: RangeId, hasHours = true): Gran {
  const want: Gran = range === "today" ? "hour" : range === "all" ? "month" : "day";
  const grans = gransFor(range, hasHours);
  return grans.includes(want) ? want : grans[0];
}

function iso(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** 今天，YYYY-MM-DD，和 ccusage 输出的日期格式一样 */
export function todayIso(): string {
  return iso(new Date());
}

/** 时间范围对应的 --since；"全部"不传 */
export function rangeSince(range: RangeId): string | undefined {
  const d = new Date();
  switch (range) {
    case "today":
      return toArg(d);
    case "7d":
      d.setDate(d.getDate() - 6);
      return toArg(d);
    case "30d":
      d.setDate(d.getDate() - 29);
      return toArg(d);
    case "month":
      return toArg(new Date(d.getFullYear(), d.getMonth(), 1));
    case "all":
      return undefined;
  }
}

export function monthSince(): string {
  const d = new Date();
  return toArg(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** 算日均用的天数：固定范围按日历天数，"全部"按有用量的天数 */
export function rangeDays(range: RangeId, rows: ClaudeDailyRow[]): number {
  switch (range) {
    case "today":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "month":
      return new Date().getDate();
    case "all":
      return Math.max(1, rows.length);
  }
}

// ---------- 从账本里取一段时间 ----------

/** "YYYYMMDD" 转成和 ccusage 日期一样的 "YYYY-MM-DD"，方便直接比大小 */
export function argToIso(arg: string): string {
  return `${arg.slice(0, 4)}-${arg.slice(4, 6)}-${arg.slice(6, 8)}`;
}

/** 账本里的行是按项目拆开的，同一天合成一行：token、费用相加，模型拆分按模型名相加 */
export function mergeByDate(rows: ClaudeDailyRow[]): ClaudeDailyRow[] {
  const map = new Map<string, ClaudeDailyRow>();
  for (const r of rows) {
    const day = map.get(r.date);
    if (!day) {
      map.set(r.date, {
        ...r,
        project: undefined,
        modelsUsed: [...r.modelsUsed],
        modelBreakdowns: r.modelBreakdowns.map((b) => ({ ...b })),
      });
      continue;
    }
    day.inputTokens += r.inputTokens;
    day.outputTokens += r.outputTokens;
    day.cacheCreationTokens += r.cacheCreationTokens;
    day.cacheReadTokens += r.cacheReadTokens;
    day.totalTokens += r.totalTokens;
    day.totalCost += r.totalCost;
    for (const m of r.modelsUsed) if (!day.modelsUsed.includes(m)) day.modelsUsed.push(m);
    for (const b of r.modelBreakdowns) {
      const same = day.modelBreakdowns.find((x) => x.modelName === b.modelName);
      if (!same) {
        day.modelBreakdowns.push({ ...b });
        continue;
      }
      same.inputTokens += b.inputTokens;
      same.outputTokens += b.outputTokens;
      same.cacheCreationTokens += b.cacheCreationTokens;
      same.cacheReadTokens += b.cacheReadTokens;
      same.cost += b.cost;
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 一段时间的合计：把 ccusage 每天的数字加起来（和 ccusage 自己的 totals 是同一组数相加） */
export function sumTotals(rows: ClaudeDailyRow[]): TokenCounts & { totalCost: number } {
  const t = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, totalCost: 0 };
  for (const r of rows) {
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.cacheCreationTokens += r.cacheCreationTokens;
    t.cacheReadTokens += r.cacheReadTokens;
    t.totalTokens += r.totalTokens;
    t.totalCost += r.totalCost;
  }
  return t;
}

/** 缓存读取占比 = 缓存读取 ÷（输入 + 缓存写入 + 缓存读取），ccusage 不直接给，这里算 */
export function cacheShare(t: TokenCounts): number {
  const base = t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens;
  return base > 0 ? t.cacheReadTokens / base : 0;
}

// ---------- 图表系列：按模型 ----------

export interface Series {
  id: string;
  /** 显示名；合并的那一项是 null，由界面显示"其他" */
  name: string | null;
  color: string;
  /** 这个系列包含哪些模型（"其他"会有好几个） */
  models: string[];
  /** 按小时时 ccusage 不给每个模型的拆分，只有一个"合计"系列，值取整桶的合计 */
  total?: boolean;
}

/** 按小时显示时唯一的那个系列 */
export const TOTAL_SERIES: Series = { id: "__total", name: null, color: SERIES[0], models: [], total: true };

/** 按费用从高到低给模型配色；模型太多时，排在后面的合并成"其他" */
export function pickSeries(rows: ClaudeDailyRow[]): Series[] {
  const cost = new Map<string, number>();
  for (const row of rows) {
    for (const b of row.modelBreakdowns) cost.set(b.modelName, (cost.get(b.modelName) ?? 0) + b.cost);
  }
  const names = [...cost.keys()].sort((a, b) => (cost.get(b) ?? 0) - (cost.get(a) ?? 0));
  if (names.length <= SERIES.length) {
    return names.map((name, i) => ({ id: name, name, color: SERIES[i], models: [name] }));
  }
  const keep = SERIES.length - 1;
  return [
    ...names.slice(0, keep).map((name, i) => ({ id: name, name, color: SERIES[i], models: [name] })),
    { id: "__other", name: null, color: OTHER, models: names.slice(keep) },
  ];
}

// ---------- 按小时 / 日 / 周 / 月分桶 ----------

export interface Bucket {
  /** 小时：YYYY-MM-DDTHH（本地时间）；日：YYYY-MM-DD；周：这周第一天（周日）；月：YYYY-MM */
  key: string;
  cost: number;
  tokens: number;
  /** 每个模型的费用和 token（按小时时没有） */
  models: Map<string, { cost: number; tokens: number }>;
  /** 按小时时才有：调用次数、用到的模型 */
  calls?: number;
  modelNames?: string[];
}

/** 本地时间的整点，转成桶的 key：YYYY-MM-DDTHH */
function hourKey(date: Date): string {
  return `${iso(date)}T${String(date.getHours()).padStart(2, "0")}`;
}

/** 小时桶 key 转回本地时间 */
export function parseHour(key: string): Date {
  const d = parseDay(key.slice(0, 10));
  d.setHours(Number(key.slice(11, 13)));
  return d;
}

/**
 * 按小时分桶。数据来自 ccusage claude blocks --session-length 1：块长 1 小时，费用也是 ccusage 算的
 * （已核对过，加起来和日报完全一致）。块按 UTC 整点切：整点时区里正好是本地的每个整点；半小时时区里从 xx:30 开始，
 * 归到它所在的本地钟点；夏令时回拨那天两个块落在同一个钟点，加起来（不能后一个盖掉前一个）。
 * 桶按"哪天的几点"排，每天固定 24 个（夏令时那天也是），小 Dock 拿下标当钟点用。
 * 没用量的小时补 0：今天补满 24 小时，其余范围补到当前这个小时
 */
export function hourBuckets(blocks: Block[], range: RangeId): Bucket[] {
  const used = new Map<string, { cost: number; tokens: number; calls: number; models: Set<string> }>();
  for (const b of blocks) {
    if (b.isGap) continue;
    const key = hourKey(new Date(b.startTime));
    const u = used.get(key) ?? { cost: 0, tokens: 0, calls: 0, models: new Set<string>() };
    u.cost += b.costUSD;
    u.tokens += b.totalTokens;
    u.calls += b.entries;
    for (const m of b.models) u.models.add(m);
    used.set(key, u);
  }

  const now = new Date();
  const today = parseDay(iso(now));
  const days = range === "7d" ? 7 : 1;
  const buckets: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const isToday = i === 0;
    for (let h = 0; h < 24; h++) {
      // 不是"今天"这个范围时，只到当前这个小时
      if (range !== "today" && isToday && h > now.getHours()) break;
      const key = `${iso(day)}T${String(h).padStart(2, "0")}`;
      const u = used.get(key);
      buckets.push({
        key,
        cost: u?.cost ?? 0,
        tokens: u?.tokens ?? 0,
        models: new Map(),
        calls: u?.calls ?? 0,
        modelNames: u ? [...u.models] : [],
      });
    }
  }
  return buckets;
}

/** 按日报行分桶的粒度（按小时用 hourBuckets） */
export type DayGran = Exclude<Gran, "hour">;

/** 一周从哪天开始（设置里选，ccusage 默认周日） */
export type WeekStart = "sunday" | "monday";

function bucketKey(day: string, gran: DayGran, weekStart: WeekStart): string {
  if (gran === "day") return day;
  if (gran === "month") return day.slice(0, 7);
  // 周的 key 是这周第一天
  const d = parseDay(day);
  const back = weekStart === "monday" ? (d.getDay() + 6) % 7 : d.getDay();
  d.setDate(d.getDate() - back);
  return iso(d);
}

function addRow(bucket: Bucket, row: ClaudeDailyRow) {
  bucket.cost += row.totalCost;
  bucket.tokens += row.totalTokens;
  for (const b of row.modelBreakdowns) {
    const m = bucket.models.get(b.modelName) ?? { cost: 0, tokens: 0 };
    m.cost += b.cost;
    m.tokens += b.inputTokens + b.outputTokens + b.cacheCreationTokens + b.cacheReadTokens;
    bucket.models.set(b.modelName, m);
  }
}

export function toBuckets(rows: ClaudeDailyRow[], gran: DayGran, weekStart: WeekStart): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = bucketKey(row.date, gran, weekStart);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, cost: 0, tokens: 0, models: new Map() };
      map.set(key, bucket);
    }
    addRow(bucket, row);
  }
  return [...map.values()];
}

/** 整个时间范围合成一桶 */
export function totalBucket(rows: ClaudeDailyRow[]): Bucket {
  const bucket: Bucket = { key: "all", cost: 0, tokens: 0, models: new Map() };
  for (const row of rows) addRow(bucket, row);
  return bucket;
}

/** 某个系列在某个桶里的值 */
export function seriesValue(bucket: Bucket, series: Series, metric: Metric): number {
  if (series.total) return metric === "cost" ? bucket.cost : bucket.tokens;
  let sum = 0;
  for (const name of series.models) {
    const m = bucket.models.get(name);
    if (m) sum += metric === "cost" ? m.cost : m.tokens;
  }
  return sum;
}

// ---------- 全部 Agent（ccusage daily --by-agent）----------
// 统一报表的行和 Claude Code 日报的行字段几乎一样，转成 ClaudeDailyRow 后，图表、环形图、指标卡都能直接用

/** 某一个 Agent 每天的用量（按模型拆分） */
export function agentDays(rows: AllAgentsRow[], agent: string): ClaudeDailyRow[] {
  return rows.flatMap((r) => {
    const a = r.agents?.find((x) => x.agent === agent);
    return a ? [{ ...a, date: r.period }] : [];
  });
}

/** 全部 Agent 每天的合计（按模型拆分，同名模型跨 Agent 已经由 ccusage 合在一起） */
export function allDays(rows: AllAgentsRow[]): ClaudeDailyRow[] {
  return rows.map((r) => ({ ...r, date: r.period }));
}

/** 全部 Agent 每天的合计，但拆分换成按 Agent：图表和环形图按 Agent 堆叠时用（"模型名"其实是 Agent id） */
export function agentStackDays(rows: AllAgentsRow[]): ClaudeDailyRow[] {
  return rows.map((r) => ({
    ...r,
    date: r.period,
    modelsUsed: (r.agents ?? []).map((a) => a.agent),
    modelBreakdowns: (r.agents ?? []).map((a) => ({
      modelName: a.agent,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheCreationTokens: a.cacheCreationTokens,
      cacheReadTokens: a.cacheReadTokens,
      cost: a.totalCost,
    })),
  }));
}

// ---------- 项目 ----------

export interface ProjectTotal {
  /** ~/.claude/projects 下的目录名 */
  name: string;
  cost: number;
  tokens: number;
}

/** 账本里按项目拆开的行，按项目汇总；没有项目名的行（ccusage 没拆项目时）不算 */
export function projectTotals(rows: ClaudeDailyRow[]): ProjectTotal[] {
  const map = new Map<string, ProjectTotal>();
  for (const r of rows) {
    if (!r.project) continue;
    const p = map.get(r.project) ?? { name: r.project, cost: 0, tokens: 0 };
    p.cost += r.totalCost;
    p.tokens += r.totalTokens;
    map.set(r.project, p);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

/** Claude Code 把路径里的 :\/. 都换成了 -，比如 D--IdeaProjects-ccusage-ui；去掉开头的盘符好读一点 */
export function projectLabel(name: string): string {
  return name.replace(/^[A-Za-z]--/, "");
}
