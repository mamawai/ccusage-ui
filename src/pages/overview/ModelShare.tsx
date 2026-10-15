// 模型分布：环形图按费用占比转出来，右边列出每个模型
import { useMemo } from "react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { agentName } from "../../ccusage/agents";
import type { ClaudeDailyRow } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { money, percent, tokens } from "../../ui/format";
import { Panel } from "../../ui/Panel";
import { pickSeries, seriesValue, totalBucket } from "./data";
import styles from "./Overview.module.css";

interface Props {
  rows: ClaudeDailyRow[];
  /** 行里的"模型"其实是 Agent：标题换成 Agent 分布，名字换成显示名 */
  byAgent?: boolean;
  delay?: number;
}

export function ModelShare({ rows, byAgent = false, delay = 220 }: Props) {
  const { t } = useI18n();

  // 整个时间范围合成一桶，按系列（模型或 Agent）汇总
  const slices = useMemo(() => {
    const all = totalBucket(rows);
    return pickSeries(rows).map((s) => ({
      series: s,
      name: s.name ? (byAgent ? agentName(s.name) : s.name) : t("chart.other"),
      cost: seriesValue(all, s, "cost"),
      tokens: seriesValue(all, s, "tokens"),
      share: all.cost > 0 ? seriesValue(all, s, "cost") / all.cost : 0,
    }));
  }, [rows, t, byAgent]);

  const total = slices.reduce((a, s) => a + s.cost, 0);

  return (
    <Panel title={byAgent ? t("agents.share") : t("models.title")} sub={t("models.sub")} delay={delay}>
      {slices.length === 0 ? (
        <div className={styles.empty}>{t("chart.empty")}</div>
      ) : (
        <div className={`${styles.donutWrap} tnum`}>
          <div className={styles.donut}>
            <PieChart responsive style={{ width: 168, height: 168 }}>
              <Pie
                data={slices}
                dataKey="cost"
                nameKey="name"
                innerRadius="64%"
                outerRadius="98%"
                startAngle={90}
                endAngle={-270}
                paddingAngle={slices.length > 1 ? 1.5 : 0}
                stroke="none"
                isAnimationActive
                animationDuration={900}
                animationEasing="ease-out"
              >
                {slices.map((s) => (
                  <Cell key={s.series.id} fill={s.series.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof slices)[number] | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className={`${styles.tip} tnum`}>
                      <div className={styles.tipHead}>{p.name}</div>
                      <div className={styles.tipRow}>
                        <span className={styles.tipName}>{money(p.cost)}</span>
                        <span>{percent(p.share)}</span>
                      </div>
                      <div className={styles.small}>{t("chart.tokens", { n: tokens(p.tokens) })}</div>
                    </div>
                  );
                }}
              />
            </PieChart>
            <div className={styles.donutCenter}>
              <span className={styles.mid}>
                <AnimatedNumber value={total} format={money} />
              </span>
            </div>
          </div>

          <div className={styles.donutList}>
            {slices.map((s) => (
              <div key={s.series.id} className={styles.sideLine}>
                <span className={styles.swatch} style={{ background: s.series.color, width: 8, height: 8 }} />
                <span className={`${styles.tipName} ${s.series.name && !byAgent ? styles.mono : ""}`}>{s.name}</span>
                <span style={{ fontWeight: 500 }}>{money(s.cost)}</span>
                <span className={styles.sideMeta} style={{ width: 52 }}>
                  {percent(s.share)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
