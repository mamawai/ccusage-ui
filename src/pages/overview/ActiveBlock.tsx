// 当前 5h 窗口：官方限额（5h、7 天：用了多少、几点重置）+ ccusage 算的窗口内已用和燃烧速率 + 生成速度。
// 限额只用 Claude Code 给的官方数据，从没读到过就不显示，不估算
import { BURN_COLOR, burnLevel } from "../../ccusage/blocks";
import {
  minutesLeft,
  resetIso,
  sevenDayBudget,
  useOfficialLimits,
  type LiveLimit,
  type WeekBudget,
} from "../../ccusage/limits";
import { subscriptionSpent, type Spend } from "../../ccusage/plans";
import { tokPerSec, tokPerSecValue, useSpeed } from "../../ccusage/speed";
import type { Block } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { duration, money, resetClock, tokens } from "../../ui/format";
import { Meter } from "../../ui/Meter";
import { useNow } from "../../ui/useNow";
import styles from "./Overview.module.css";

/**
 * hours：Claude Code 按小时的块；nonSubscription：认出来的非订阅会话每小时的花费（见 plans.ts）。
 * 7 天额度估多少钱、5h 窗口内已用，都剔除非订阅会话（和官方限额放在一起比的数）
 */
export function ActiveBlock({
  block,
  hours,
  nonSubscription,
}: {
  block: Block | undefined;
  hours: Block[];
  nonSubscription: Spend[] | undefined;
}) {
  const { t } = useI18n();
  // 重置倒计时每 30 秒走一次
  const now = useNow(30_000);
  const { fiveHour, sevenDay } = useOfficialLimits(now);
  const speed = useSpeed();

  if (!block && !fiveHour && !sevenDay && !speed) return <div className={styles.blockNone}>{t("block.none")}</div>;

  const level = block?.burnRate ? burnLevel(block.burnRate.tokensPerMinuteForIndicator) : null;
  // 5h 窗口里订阅花的：剔除认出来的非订阅会话
  const blockSub = block ? subscriptionSpent(block.costUSD, nonSubscription, Date.parse(block.startTime)) : null;

  return (
    <section className={`${styles.block} tnum`} aria-label={t("block.title")}>
      {fiveHour && <LimitCell name={t("limits.fiveHour")} w={fiveHour} now={now} />}
      {sevenDay && (
        <LimitCell
          name={t("limits.sevenDay")}
          w={sevenDay}
          now={now}
          budget={sevenDayBudget(sevenDay, hours, nonSubscription)}
        />
      )}

      {/* 生成速度紧跟在限额百分比后面：最近一条回复，下面是近 1 小时的平均 */}
      {speed && (
        <div className={styles.blockCell}>
          <span className={styles.label}>{t("speed.title")}</span>
          <span className={styles.mid}>
            <AnimatedNumber value={speed.last} format={tokPerSecValue} />
            <span className={styles.unit}> tok/s</span>
          </span>
          <span className={styles.small}>{t("speed.sub", { avg: tokPerSec(speed.avg) })}</span>
        </div>
      )}

      {block && (
        <div className={styles.blockCell}>
          <span className={styles.label}>{t("block.used")}</span>
          <span className={styles.mid}>
            <AnimatedNumber value={blockSub?.spent ?? block.costUSD} format={money} />
          </span>
          <span className={styles.small}>
            {[
              t("block.calls", { tokens: tokens(block.totalTokens), n: block.entries }),
              blockSub && blockSub.excluded >= 0.01 ? t("plans.excluded", { cost: money(blockSub.excluded) }) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}

      {block?.burnRate && level && (
        <div className={styles.blockCell}>
          <span className={styles.label}>{t("block.burn")}</span>
          <span className={styles.mid}>
            <AnimatedNumber value={block.burnRate.costPerHour} format={money} />
            <span className={styles.unit}> {t("block.perHour")}</span>
          </span>
          <span className={`${styles.small} ${styles.row}`}>
            <span className={styles.dot} style={{ background: BURN_COLOR[level] }} />
            {t(`block.burn.${level}`)}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * 一个官方限额：用了百分之几、进度条、多久后重置；过了重置时间、新数据还没到时是 0% · 已重置。
 * 7 天的那个传 budget：多一行"这一轮订阅花了多少（剔除了多少非订阅）· 整个额度约多少"
 */
function LimitCell({
  name,
  w,
  now,
  budget,
}: {
  name: string;
  w: LiveLimit;
  now: number;
  budget?: WeekBudget | null;
}) {
  const { t, lang } = useI18n();
  const ratio = w.usedPercentage / 100;
  return (
    <div className={styles.blockCell}>
      <span className={styles.label}>{name}</span>
      <span className={styles.mid}>
        <AnimatedNumber value={w.usedPercentage} format={(v) => `${Math.round(v)}%`} />
      </span>
      <Meter ratio={ratio} color={ratio >= 1 ? BURN_COLOR.high : "var(--accent)"} />
      <span className={styles.small}>
        {w.reset
          ? t("limits.resetSub")
          : t("limits.resetIn", { d: duration(minutesLeft(w, now)), time: resetClock(resetIso(w), now, lang) })}
      </span>
      {budget && (
        <span className={styles.small}>
          {budget.excluded >= 0.01
            ? t("limits.budgetExcl", {
                spent: money(budget.spent),
                excluded: money(budget.excluded),
                budget: money(budget.budget),
              })
            : t("limits.budget", { spent: money(budget.spent), budget: money(budget.budget) })}
        </span>
      )}
    </div>
  );
}
