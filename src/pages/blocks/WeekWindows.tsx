// 5h 窗口页里的"7 天窗口"：官方 7 天限额进行中的这一轮和往前几轮，订阅每一轮花了多少（认出来的非订阅会话剔除，
// 见 plans.ts）；知道百分比的轮次（这一轮用现在的，往轮用 Rust 端换轮时记下的）再估"用满约多少"，最后折合一个月。
// 官方 7 天限额每 7 天在同一个时间重置，往前几轮就从这一轮的重置时间每次往前推 7 天。按 API 价格算，只是个模糊的数
import { subscriptionSpent, type Spend } from "../../ccusage/plans";
import {
  BUDGET_MIN_PERCENT,
  minutesLeft,
  SEVEN_DAYS_MS,
  spentSince,
  type LimitWindow,
  type LiveLimit,
} from "../../ccusage/limits";
import type { Block } from "../../ccusage/types";
import { useI18n, type Lang } from "../../i18n";
import { duration, money } from "../../ui/format";
import { Panel } from "../../ui/Panel";
import styles from "./Blocks.module.css";

/** 往前看几轮（连进行中的共 5 轮，一个多月） */
const PAST = 4;
/** 折合一个月按 30 天算 */
const MONTH_DAYS = 30;
/** 记下的往轮和推算的轮次对得上：重置时间差一天以内 */
const MATCH_MS = 86_400_000;

interface Week {
  start: number;
  end: number;
  /** 订阅花的（已经剔除了 excluded） */
  spent: number;
  /** 剔除的非订阅会话花费 */
  excluded: number;
  /** 进行中的是现在的百分比，往轮是结束时的；不知道就没有 */
  percent?: number;
  /** 照百分比估的整轮额度（美元）；百分比不知道或太小就没有 */
  budget?: number;
  current: boolean;
}

/**
 * 算出要显示的几轮，新的在前。花费：进行中的这一轮用按小时的块（和概览上的数一致），
 * 往轮用 5h 块（按开始时间归到哪一轮）。刚过重置时间、新一轮还没数据时，上一轮也算往轮
 */
function weeks(
  sevenDay: LiveLimit,
  history: LimitWindow[],
  blocks: Block[],
  hours: Block[],
  nonSubscription: Spend[],
  now: number,
): Week[] {
  const latestEnd = sevenDay.resetsAt * 1000;
  const out: Week[] = [];
  for (let k = 0; k <= PAST; k++) {
    const end = latestEnd - k * SEVEN_DAYS_MS;
    const start = end - SEVEN_DAYS_MS;
    const current = k === 0 && !sevenDay.reset && now < end;
    let all = 0;
    if (current) all = spentSince(start, hours);
    else
      for (const b of blocks) {
        const t = Date.parse(b.startTime);
        if (!b.isGap && t >= start && t < end) all += b.costUSD;
      }
    const { spent, excluded } = subscriptionSpent(all, nonSubscription, start, end);
    const percent = current
      ? sevenDay.usedPercentage
      : history.find((h) => Math.abs(h.resetsAt * 1000 - end) < MATCH_MS)?.usedPercentage;
    const budget = percent !== undefined && percent >= BUDGET_MIN_PERCENT ? spent / (percent / 100) : undefined;
    out.push({ start, end, spent, excluded, percent, budget, current });
  }
  return out;
}

/** 日期写成 10/13 / Oct 13 */
function md(ms: number, lang: Lang): string {
  const d = new Date(ms);
  return lang === "zh" ? `${d.getMonth() + 1}/${d.getDate()}` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 估出来的额度写整数美元：$1,039 */
function dollars(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

interface Props {
  /** 官方 7 天限额（进行中的这一轮） */
  sevenDay: LiveLimit;
  /** 过去几轮结束时的百分比 */
  history: LimitWindow[];
  /** 全部 5h 块 */
  blocks: Block[];
  /** 按小时的块 */
  hours: Block[];
  /** 认出来的非订阅会话每小时的花费 */
  nonSubscription: Spend[];
  now: number;
}

export function WeekWindows({ sevenDay, history, blocks, hours, nonSubscription, now }: Props) {
  const { t, lang } = useI18n();
  const list = weeks(sevenDay, history, blocks, hours, nonSubscription, now);
  // 条的长度按这几轮里最大的数（花的钱或估的额度）算
  const scale = Math.max(...list.map((w) => Math.max(w.spent, w.budget ?? 0)), 0.01);
  const pct = (v: number) => `${Math.round(v)}%`;
  // 折合一个月：用最近一轮估得出额度的
  const ref = list.find((w) => w.budget !== undefined);

  return (
    <Panel title={t("week.title")} sub={t("week.sub")} delay={150}>
      <div className={`${styles.weeks} tnum`}>
        {list.map((w) => (
          <div key={w.end} className={`${styles.week} ${w.current ? styles.weekNow : ""}`}>
            <div className={styles.weekWhen}>
              <span>
                {md(w.start, lang)} – {md(w.end, lang)}
              </span>
              {w.current && <span className={styles.chip}>{t("week.current")}</span>}
            </div>
            <div className={styles.weekTrack} role="img" aria-label={money(w.spent)}>
              {/* 估的整轮额度：虚线框；花了的：实心条 */}
              {w.budget !== undefined && (
                <span className={styles.weekBudget} style={{ width: `${(w.budget / scale) * 100}%` }} />
              )}
              <span className={styles.weekSpent} style={{ width: `${(w.spent / scale) * 100}%` }} />
            </div>
            <div className={styles.weekNums}>
              <b>{money(w.spent)}</b>
              <span className={styles.small}>
                {[
                  w.current
                    ? w.budget !== undefined
                      ? t("week.usedBudget", { pct: pct(w.percent ?? 0), budget: dollars(w.budget) })
                      : pct(w.percent ?? 0)
                    : w.percent === undefined
                      ? ""
                      : w.budget !== undefined
                        ? t("week.ended", { pct: pct(w.percent), budget: dollars(w.budget) })
                        : t("week.endedPct", { pct: pct(w.percent) }),
                  w.current ? t("week.left", { d: duration(minutesLeft(sevenDay, now)) }) : "",
                  // 剔除了多少非订阅会话的花费
                  w.excluded >= 0.01 ? t("plans.excluded", { cost: money(w.excluded) }) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>
        ))}
        {ref?.budget !== undefined && (
          <p className={styles.weekMonth}>
            {t("week.month", {
              range: `${md(ref.start, lang)} – ${md(ref.end, lang)}`,
              week: dollars(ref.budget),
              month: dollars((ref.budget * MONTH_DAYS) / 7),
            })}
          </p>
        )}
        <p className={styles.weekNote}>{t("week.note")}</p>
      </div>
    </Panel>
  );
}
