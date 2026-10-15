// 块内累计 token 曲线：把这个块里的每一次调用按时间累加起来画。
// ccusage 的 blocks 只给汇总，逐次的时间点要从会话明细里拼：
//   1. claude session 找出活动时间和块重叠的会话
//   2. 每个会话跑 claude session --id，留下时间落在块里的那些调用
// 这样拼出来的条数和 token 跟 blocks 给的完全一致（拿真实数据核对过）。只画 token：单次调用没有可靠的费用
import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { claudeSession, claudeSessionDetail } from "../../ccusage/api";
import type { Block } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { clock, toArg, tokens } from "../../ui/format";
import { CHART, SERIES } from "../../ui/palette";
import styles from "./Blocks.module.css";

const HEIGHT = 190;

interface Point {
  t: number;
  cum: number;
}

/** 已结束的块不会再变，读过一次就记住，来回切换时不用再跑 ccusage */
const ended = new Map<string, Point[]>();

/** 读一个块里逐次调用的累计 token。version 变了（进行中的块、账本刷新了）就重读 */
function useCurve(block: Block, version: number) {
  const [state, setState] = useState<{ id: string; points: Point[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const cached = version === 0 ? ended.get(block.id) : undefined;

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    const start = Date.parse(block.startTime);
    const end = Date.parse(block.endTime);
    // 往前多取一天：块开始前就开着的会话也要算进来；token 和价格无关，一律用内置价格不联网
    const opts = { since: toArg(new Date(start - 86_400_000)), offline: true };
    (async () => {
      const list = await claudeSession(opts);
      const ids = list.sessions
        .filter((s) => Date.parse(s.lastActivity) >= start && Date.parse(s.firstActivity) < end)
        .map((s) => s.sessionId);
      const details = await Promise.all(ids.map((id) => claudeSessionDetail(id, opts)));
      const calls = details
        .flatMap((d) => d?.entries ?? [])
        .map((e) => ({ t: Date.parse(e.timestamp), tok: e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens }))
        .filter((e) => e.t >= start && e.t < end)
        .sort((a, b) => a.t - b.t);
      let cum = 0;
      const points = [{ t: start, cum: 0 }, ...calls.map((c) => ({ t: c.t, cum: (cum += c.tok) }))];
      if (version === 0) ended.set(block.id, points);
      if (!cancelled) {
        setState({ id: block.id, points });
        setFailed(false);
      }
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [block.id, block.startTime, block.endTime, version, cached]);

  // 换了块，旧块的曲线不能拿来显示；同一个块重读时先留着旧的，免得闪
  return { points: cached ?? (state?.id === block.id ? state.points : null), failed };
}

interface Props {
  block: Block;
  /** 进行中的块传账本刷新时间，变了就重读；结束了的块传 0，不重读 */
  version: number;
  /** 进行中的块才画"现在" */
  live: boolean;
  now: number;
}

export function BlockCurve({ block, version, live, now }: Props) {
  const { t } = useI18n();
  const { points, failed } = useCurve(block, version);
  const start = Date.parse(block.startTime);
  const end = Date.parse(block.endTime);

  if (!points) {
    return (
      <div className={styles.curveWait} style={{ height: HEIGHT }}>
        {failed ? t("error.unknown") : t("blocks.curveLoading")}
      </div>
    );
  }

  const top = points[points.length - 1].cum * 1.08 || 1;
  // 每小时一个刻度
  const ticks: number[] = [];
  for (let x = start; x <= end; x += 3_600_000) ticks.push(x);
  const nowX = Math.min(now, end);

  return (
    <div className="tnum">
      <ComposedChart data={points} responsive style={{ width: "100%", height: HEIGHT }} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis
          dataKey="t"
          type="number"
          domain={[start, end]}
          ticks={ticks}
          tickFormatter={(x: number) => clock(new Date(x).toISOString())}
          tick={{ fontSize: 11, fill: CHART.ink3 }}
          tickLine={false}
          axisLine={{ stroke: CHART.axis }}
        />
        <YAxis
          domain={[0, top]}
          tickFormatter={tokens}
          tick={{ fontSize: 11, fill: CHART.ink3 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        {live && <ReferenceLine x={nowX} stroke={SERIES[0]} strokeOpacity={0.5} />}
        <Tooltip
          cursor={{ stroke: CHART.axis }}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as Point | undefined;
            if (!active || !p) return null;
            return (
              <div className={`${styles.tip} tnum`}>
                <div className={styles.tipHead}>{clock(new Date(p.t).toISOString())}</div>
                <div>{t("chart.tokens", { n: tokens(p.cum) })}</div>
              </div>
            );
          }}
        />
        {/* 阶梯线：每次调用 token 跳一下，比平滑曲线更贴实际 */}
        <Area
          type="stepAfter"
          dataKey="cum"
          stroke={SERIES[1]}
          strokeWidth={2}
          fill={SERIES[1]}
          fillOpacity={0.06}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </ComposedChart>
    </div>
  );
}
