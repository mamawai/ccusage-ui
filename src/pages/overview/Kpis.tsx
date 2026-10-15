// 顶部四个指标：本期费用、今日费用、Token 总量、缓存读取占比
import type { ReactNode } from "react";
import type { TokenCounts } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { money, percent, tokens } from "../../ui/format";
import { Meter } from "../../ui/Meter";
import { cacheShare } from "./data";
import styles from "./Overview.module.css";

interface Props {
  /** 所选时间范围的合计 */
  totals: TokenCounts & { totalCost: number };
  todayCost: number;
  monthCost: number;
  /** 算日均用的天数 */
  days: number;
}

export function Kpis({ totals, todayCost, monthCost, days }: Props) {
  const { t } = useI18n();
  const share = cacheShare(totals);

  return (
    <section className={`${styles.kpis} tnum`} aria-label={t("overview.kpis")}>
      <Kpi
        label={t("overview.kpi.period")}
        value={<AnimatedNumber value={totals.totalCost} format={money} />}
        sub={t("overview.kpi.avg", { value: money(totals.totalCost / days), days })}
      />
      <Kpi
        label={t("overview.kpi.today")}
        accent
        value={<AnimatedNumber value={todayCost} format={money} />}
        sub={t("overview.kpi.month", { value: money(monthCost) })}
      />
      <Kpi
        label={t("overview.kpi.tokens")}
        value={<AnimatedNumber value={totals.totalTokens} format={tokens} />}
        sub={t("overview.kpi.io", { input: tokens(totals.inputTokens), output: tokens(totals.outputTokens) })}
      />
      <Kpi
        label={t("overview.kpi.cache")}
        value={<AnimatedNumber value={share} format={(v) => percent(v)} />}
        sub={t("overview.kpi.cacheSub", {
          read: tokens(totals.cacheReadTokens),
          write: tokens(totals.cacheCreationTokens),
        })}
        extra={<Meter ratio={share} color="var(--accent)" height={4} />}
      />
    </section>
  );
}

function Kpi(props: { label: string; value: ReactNode; sub: string; accent?: boolean; extra?: ReactNode }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.label}>{props.label}</span>
      <span className={`${styles.big} ${props.accent ? styles.accent : ""}`}>{props.value}</span>
      {props.extra}
      <span className={styles.small}>{props.sub}</span>
    </div>
  );
}
