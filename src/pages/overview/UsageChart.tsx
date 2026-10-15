// 用量趋势：柱状图，可切费用 / Token；粒度跟着时间范围走（今天按小时，越长越粗），点柱子在右边看这一段的明细。
// 按日 / 周 / 月时按模型堆叠；按小时时 ccusage 不给每个模型的拆分，只画合计
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceArea, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { Block, ClaudeDailyRow } from "../../ccusage/types";
import { useI18n, type Lang, type Translate } from "../../i18n";
import { useSettings } from "../../settings";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { longDay, money, monthLabel, percent, shortDay, tokens } from "../../ui/format";
import { Meter } from "../../ui/Meter";
import { CHART } from "../../ui/palette";
import { Panel } from "../../ui/Panel";
import { barInterpolate } from "../../ui/barAnim";
import { Segmented } from "../../ui/Segmented";
import { agentName } from "../../ccusage/agents";
import {
  defaultGran,
  gransFor,
  hourBuckets,
  parseHour,
  pickSeries,
  seriesValue,
  toBuckets,
  TOTAL_SERIES,
  type Bucket,
  type Gran,
  type Metric,
  type RangeId,
  type Series,
} from "./data";
import styles from "./Overview.module.css";

interface Props {
  rows: ClaudeDailyRow[];
  /** 按小时的计费块（--session-length 1）；只有 Claude Code 有，别的 Agent 不传，就没有"时"这个粒度 */
  hours: Block[] | undefined;
  range: RangeId;
  /** 行里的"模型"其实是 Agent（全部 Agent 时按 Agent 堆叠） */
  byAgent?: boolean;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

/** 横轴刻度和明细标题上的周期名；long 为 true 时是完整的说法 */
function bucketLabel(key: string, gran: Gran, range: RangeId, lang: Lang, t: Translate, long: boolean): string {
  if (gran === "hour") {
    const start = parseHour(key);
    const time = long ? `${hhmm(start)} – ${hhmm(new Date(start.getTime() + 3_600_000))}` : hhmm(start);
    if (range === "today") return time;
    // 好几天按小时：横轴只在每天 0 点有刻度，显示日期；完整说法是日期 + 时段
    const day = key.slice(0, 10);
    return long ? `${longDay(day, lang)} ${time}` : shortDay(day, lang);
  }
  if (gran === "month") return monthLabel(key, lang);
  if (gran === "week") return long ? t("chart.weekOf", { date: shortDay(key, lang) }) : shortDay(key, lang);
  return long ? longDay(key, lang) : shortDay(key, lang);
}

/** 纵轴刻度：$120、$1.5K */
function axisMoney(v: number): string {
  return v >= 1000 ? `$${+(v / 1000).toFixed(1)}K` : `$${+v.toFixed(0)}`;
}

function seriesName(s: Series, t: Translate, byAgent: boolean): string {
  if (s.total) return t("chart.allModels");
  if (!s.name) return t("chart.other");
  return byAgent ? agentName(s.name) : s.name;
}

/** 模型名用等宽字体，Agent 名和"其他"不用 */
function nameClass(s: Series, byAgent: boolean): string {
  return s.name && !s.total && !byAgent ? styles.mono : "";
}

export function UsageChart({ rows, hours, range, byAgent = false }: Props) {
  const { t, lang } = useI18n();
  const { weekStart } = useSettings().settings;
  const hasHours = hours !== undefined;
  const [metric, setMetric] = useState<Metric>("cost");
  const [granPick, setGran] = useState<Gran>(() => defaultGran(range, hasHours));
  const [picked, setPicked] = useState<number | null>(null);
  const grans = gransFor(range, hasHours);
  // 刚换时间范围的那一下，选中的粒度可能不属于新范围（比如从"今天"的按小时换到 30 天），先按新范围的默认值画
  const gran = grans.includes(granPick) ? granPick : defaultGran(range, hasHours);
  // 第一次出现柱子慢一点长出来，之后切换时快一点，免得每次切换都要等
  const drawn = useRef(false);
  useEffect(() => {
    drawn.current = true;
  }, []);

  // 换了时间范围（或者换了统计范围，能不能按小时变了）：粒度回到默认值
  useEffect(() => {
    setGran(defaultGran(range, hasHours));
    setPicked(null);
  }, [range, hasHours]);

  const hourly = gran === "hour";
  const series = useMemo(() => (gran === "hour" ? [TOTAL_SERIES] : pickSeries(rows)), [gran, rows]);
  const buckets = useMemo(
    () => (gran === "hour" ? hourBuckets(hours ?? [], range) : toBuckets(rows, gran, weekStart)),
    [gran, hours, rows, range, weekStart],
  );
  const data = useMemo(
    () =>
      buckets.map((b) => {
        const point: Record<string, string | number> = { key: b.key };
        series.forEach((s, i) => (point[`s${i}`] = seriesValue(b, s, metric)));
        return point;
      }),
    [buckets, series, metric],
  );

  // 按小时时横轴刻度自己定：今天每 3 小时一个，好几天时每天 0 点一个
  const ticks = hourly
    ? buckets
        .map((b) => b.key)
        .filter((key) => (range === "today" ? Number(key.slice(11)) % 3 === 0 : key.endsWith("T00")))
    : undefined;

  // 柱子的集合（粒度 + 第一段 + 最后一段 + 段数）变了（切粒度、换时间范围）：
  // 不让旧柱子拉伸挪位去凑新柱子（很乱），而是换个 key 整张重画——新图淡入上浮，柱子从底部一层层长出来。
  // 集合没变（切费用 / Token、自动刷新）就保持同一张图，柱子高度平滑过渡到新值
  const barsKey = `${gran}:${buckets[0]?.key}:${buckets[buckets.length - 1]?.key}:${buckets.length}`;
  const growMs = drawn.current ? 500 : 750;

  // 没点过：按小时时看最近一个有用量的小时，其余看最后一段（今天 / 本周 / 本月）
  let fallback = buckets.length - 1;
  if (hourly) {
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].cost > 0) {
        fallback = i;
        break;
      }
    }
  }
  const sel = picked !== null && picked < buckets.length ? picked : fallback;
  const selBucket: Bucket | undefined = buckets[sel];
  const fmt = metric === "cost" ? money : tokens;

  const actions = (
    <>
      <Segmented<Metric>
        label={t("chart.metric")}
        value={metric}
        onChange={setMetric}
        options={[
          { value: "cost", label: t("chart.metric.cost") },
          { value: "tokens", label: t("chart.metric.tokens") },
        ]}
      />
      {/* 这个时间范围只有一种粒度时（今天只能按小时），就不放切换了 */}
      {grans.length > 1 && (
        <Segmented<Gran>
          label={t("chart.gran")}
          value={gran}
          onChange={(g) => {
            setGran(g);
            setPicked(null);
          }}
          options={grans.map((g) => ({ value: g, label: t(`chart.gran.${g}`) }))}
        />
      )}
    </>
  );

  return (
    <div className={styles.trend}>
      <Panel
        title={t("chart.title")}
        sub={hourly ? t("chart.subHour") : byAgent ? t("chart.subAgent") : t("chart.sub")}
        actions={actions}
        delay={120}
        className={styles.trendMain}
      >
        {buckets.length === 0 ? (
          <div className={styles.empty}>{t("chart.empty")}</div>
        ) : (
          <>
            <div key={barsKey} className={`${styles.chartBox} ${styles.chartIn} tnum`}>
              <BarChart
                data={data}
                responsive
                style={{ width: "100%", height: 240 }}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                barCategoryGap="24%"
                onClick={(state) => {
                  const i = Number(state?.activeTooltipIndex);
                  if (Number.isInteger(i)) setPicked(i);
                }}
              >
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis
                  dataKey="key"
                  ticks={ticks}
                  interval={ticks ? 0 : "preserveEnd"}
                  tickFormatter={(key: string) => bucketLabel(key, gran, range, lang, t, false)}
                  tick={{ fontSize: 11, fill: CHART.ink3 }}
                  tickLine={false}
                  axisLine={{ stroke: CHART.axis }}
                  minTickGap={18}
                />
                <YAxis
                  tickFormatter={metric === "cost" ? axisMoney : tokens}
                  tick={{ fontSize: 11, fill: CHART.ink3 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                {/* 选中的那一列铺一层浅灰底 */}
                {selBucket && (
                  <ReferenceArea x1={selBucket.key} x2={selBucket.key} fill={CHART.highlight} fillOpacity={1} />
                )}
                <Tooltip
                  cursor={{ fill: CHART.highlight }}
                  content={(props) => (
                    <ChartTip
                      {...props}
                      series={series}
                      buckets={buckets}
                      gran={gran}
                      range={range}
                      fmt={fmt}
                      byAgent={byAgent}
                    />
                  )}
                />
                {series.map((s, i) => (
                  <Bar
                    key={s.id}
                    dataKey={`s${i}`}
                    stackId="usage"
                    fill={s.color}
                    maxBarSize={36}
                    isAnimationActive
                    // 改窗口大小时柱子直接到新位置，不横着挪过去
                    animationInterpolateFn={barInterpolate}
                    animationBegin={i * 60}
                    animationDuration={growMs}
                    animationEasing="ease-out"
                    style={{ cursor: "pointer" }}
                  />
                ))}
              </BarChart>
            </div>
            <div className={styles.legend}>
              {series.map((s) => (
                <span key={s.id} className={styles.row}>
                  <span className={styles.swatch} style={{ background: s.color }} />
                  <span className={nameClass(s, byAgent)}>{seriesName(s, t, byAgent)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel title={t("chart.selected")} delay={180} className={styles.trendSide}>
        {selBucket && (
          <div className={`${styles.side} tnum`}>
            <div className={styles.sideTotal}>
              <span className={styles.label}>{bucketLabel(selBucket.key, gran, range, lang, t, true)}</span>
              <span className={styles.big}>
                <AnimatedNumber value={selBucket.cost} format={money} />
              </span>
              <span className={styles.small}>{t("chart.tokens", { n: tokens(selBucket.tokens) })}</span>
            </div>
            {hourly ? (
              <HourDetail bucket={selBucket} />
            ) : (
              <ModelRows bucket={selBucket} series={series} byAgent={byAgent} />
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** 所选时段（按日 / 周 / 月）：每个模型（或 Agent）的费用和占比 */
function ModelRows({ bucket, series, byAgent }: { bucket: Bucket; series: Series[]; byAgent: boolean }) {
  const { t } = useI18n();
  return series.map((s) => {
    const cost = seriesValue(bucket, s, "cost");
    if (cost <= 0) return null;
    const share = bucket.cost > 0 ? cost / bucket.cost : 0;
    return (
      <div key={s.id} className={styles.sideRow}>
        <div className={styles.sideLine}>
          <span className={styles.swatch} style={{ background: s.color, width: 8, height: 8 }} />
          <span className={`${styles.tipName} ${nameClass(s, byAgent)}`}>{seriesName(s, t, byAgent)}</span>
          <span style={{ fontWeight: 500 }}>{money(cost)}</span>
        </div>
        <div className={styles.sideLine}>
          <div style={{ flex: 1 }}>
            <Meter ratio={share} color={s.color} height={4} />
          </div>
          <span className={styles.sideMeta}>
            {percent(share)} · {tokens(seriesValue(bucket, s, "tokens"))}
          </span>
        </div>
      </div>
    );
  });
}

/** 所选时段（按小时）：调用次数和用到的模型（ccusage 不给这一小时里每个模型的拆分） */
function HourDetail({ bucket }: { bucket: Bucket }) {
  const { t } = useI18n();
  return (
    <>
      <span className={styles.small}>{t("chart.calls", { n: bucket.calls ?? 0 })}</span>
      {(bucket.modelNames?.length ?? 0) > 0 && (
        <div className={styles.sideRow}>
          <span className={styles.label}>{t("chart.modelsUsed")}</span>
          {bucket.modelNames?.map((name) => (
            <span key={name} className={styles.mono}>
              {name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

interface TipProps extends TooltipContentProps {
  series: Series[];
  buckets: Bucket[];
  gran: Gran;
  range: RangeId;
  fmt: (v: number) => string;
  byAgent: boolean;
}

/** 悬停提示：这一段里每个模型（或 Agent）多少和合计；按小时时是合计、调用次数和用到的模型 */
function ChartTip({ active, payload, label, series, buckets, gran, range, fmt, byAgent }: TipProps) {
  const { t, lang } = useI18n();
  if (!active || !payload?.length) return null;
  const items = payload
    .map((p) => ({ s: series[Number(String(p.dataKey).slice(1))], value: Number(p.value) || 0 }))
    .filter((x) => x.s && x.value > 0)
    .reverse();
  const total = items.reduce((a, x) => a + x.value, 0);
  const bucket = buckets.find((b) => b.key === label);

  return (
    <div className={`${styles.tip} tnum`}>
      <div className={styles.tipHead}>{bucketLabel(String(label), gran, range, lang, t, true)}</div>
      {gran === "hour" ? (
        <>
          <div className={styles.tipRow}>
            <span className={styles.tipName}>{t("chart.allModels")}</span>
            <span>{fmt(total)}</span>
          </div>
          <div className={styles.small}>{t("chart.calls", { n: bucket?.calls ?? 0 })}</div>
          {bucket?.modelNames?.map((name) => (
            <div key={name} className={`${styles.small} ${styles.mono}`}>
              {name}
            </div>
          ))}
        </>
      ) : (
        <>
          {items.map(({ s, value }) => (
            <div key={s.id} className={styles.tipRow}>
              <span className={styles.swatch} style={{ background: s.color, width: 8, height: 8 }} />
              <span className={`${styles.tipName} ${nameClass(s, byAgent)}`}>{seriesName(s, t, byAgent)}</span>
              <span>{fmt(value)}</span>
            </div>
          ))}
          <div className={styles.tipTotal}>
            <span>{t("chart.total")}</span>
            <span>{fmt(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}
