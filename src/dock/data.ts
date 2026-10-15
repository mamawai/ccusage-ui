// 小 Dock 显示的数：从两本账本（小 Dock 自己取的，见 DockRoot）里按天相加。数字都是 ccusage 给的
import type { AgentsLedger } from "../ccusage/agents";
import { dayIso, type Ledger } from "../ccusage/ledger";
import type { WeekStart } from "../pages/overview/data";

export interface Usage {
  todayCost: number;
  todayTokens: number;
  /** 今天的输出 token（趣味句里换算成书） */
  todayOutput: number;
  weekCost: number;
  monthCost: number;
  /** 每天花了多少（YYYY-MM-DD → 美元），全部历史；趣味句里比纪录、算连续天数 */
  days: Record<string, number>;
  /** 这本账是什么时候取的 */
  fetchedAt: number;
}

/** 这周第一天（YYYY-MM-DD），一周从哪天开始按设置 */
function weekStartIso(weekStart: WeekStart): string {
  const d = new Date();
  const back = weekStart === "monday" ? (d.getDay() + 6) % 7 : d.getDay();
  d.setDate(d.getDate() - back);
  return dayIso(d);
}

/** 统计范围里今天、本周、本月的用量；这本账还没取过就是 null */
export function usageFor(
  scope: string,
  ledger: Ledger | null,
  agents: AgentsLedger | null,
  weekStart: WeekStart,
): Usage | null {
  const today = dayIso(new Date());
  const week = weekStartIso(weekStart);
  const monthStart = `${today.slice(0, 8)}01`;
  const usage: Usage = {
    todayCost: 0,
    todayTokens: 0,
    todayOutput: 0,
    weekCost: 0,
    monthCost: 0,
    days: {},
    fetchedAt: 0,
  };
  const add = (date: string, row: { totalCost: number; totalTokens: number; outputTokens: number }) => {
    if (date === today) {
      usage.todayCost += row.totalCost;
      usage.todayTokens += row.totalTokens;
      usage.todayOutput += row.outputTokens;
    }
    if (date >= week) usage.weekCost += row.totalCost;
    if (date >= monthStart) usage.monthCost += row.totalCost;
    usage.days[date] = (usage.days[date] ?? 0) + row.totalCost;
  };

  if (scope === "claude") {
    if (!ledger) return null;
    // Claude Code 账本的行是按项目拆开的，同一天的加起来
    for (const r of ledger.rows) add(r.date, r);
    usage.fetchedAt = ledger.fetchedAt;
    return usage;
  }
  if (!agents) return null;
  for (const r of agents.rows) {
    const u = scope === "all" ? r : r.agents?.find((a) => a.agent === scope);
    if (u) add(r.period, u);
  }
  usage.fetchedAt = agents.fetchedAt;
  return usage;
}
