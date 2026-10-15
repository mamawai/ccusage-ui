// 项目排行：横向柱状图，柱子从左往右长出来；第一名用强调色
import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "../../i18n";
import { money, tokens } from "../../ui/format";
import { CHART, SERIES } from "../../ui/palette";
import { Panel } from "../../ui/Panel";
import { projectLabel, type ProjectTotal } from "./data";
import styles from "./Overview.module.css";

const TOP = 6;

/** 项目名太长就截断，悬停提示里看全名 */
function shorten(label: string): string {
  return label.length > 24 ? label.slice(0, 23) + "…" : label;
}

export function ProjectRank({ projects }: { projects: ProjectTotal[] }) {
  const { t } = useI18n();
  const top = projects.slice(0, TOP).map((p) => ({ ...p, label: projectLabel(p.name) }));
  const rest = projects.slice(TOP);
  const restCost = rest.reduce((a, p) => a + p.cost, 0);

  return (
    <Panel title={t("projects.title")} sub={t("projects.sub", { n: top.length })} delay={260}>
      {top.length === 0 ? (
        <div className={styles.empty}>{t("projects.empty")}</div>
      ) : (
        <>
          <div className={`${styles.chartBox} tnum`}>
            <BarChart
              layout="vertical"
              data={top}
              responsive
              style={{ width: "100%", height: top.length * 36 + 8 }}
              margin={{ top: 0, right: 72, bottom: 0, left: 8 }}
              barCategoryGap="30%"
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={176}
                tickFormatter={shorten}
                tick={{ fontSize: 11.5, fill: CHART.ink3, fontFamily: "Geist Mono Variable, ui-monospace, monospace" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: CHART.highlight }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof top)[number] | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className={`${styles.tip} tnum`}>
                      <div className={`${styles.tipHead} ${styles.mono}`}>{p.name}</div>
                      <div className={styles.tipRow}>
                        <span className={styles.tipName}>{money(p.cost)}</span>
                        <span>{t("chart.tokens", { n: tokens(p.tokens) })}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="cost" maxBarSize={14} isAnimationActive animationDuration={850} animationEasing="ease-out">
                {top.map((p, i) => (
                  <Cell key={p.name} fill={i === 0 ? SERIES[0] : SERIES[1]} />
                ))}
                <LabelList
                  dataKey="cost"
                  position="right"
                  formatter={(v) => money(Number(v))}
                  style={{ fontSize: 11.5, fill: CHART.ink3 }}
                />
              </Bar>
            </BarChart>
          </div>
          {rest.length > 0 && (
            <div className={`${styles.footNote} tnum`}>
              {t("projects.rest", { n: rest.length, value: money(restCost) })}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
