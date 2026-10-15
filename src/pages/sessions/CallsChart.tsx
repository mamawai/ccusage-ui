// 每次调用一根柱子，四类 token 堆起来；上下文越聊越长柱子越高，突然变矮的地方一般是上下文压缩了。
// 一个会话动辄几百上千次调用，用 recharts 每根柱子每一段都是一个组件（几千个），点一下要卡一秒；
// 这里每类 token 拼成一条 path，四个元素画完全部柱子，生长动画用 CSS 整体缩放，悬停只重画高亮和提示框
import { memo, useMemo, useRef, useState } from "react";
import type { ClaudeSessionEntry } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { clock, tokens } from "../../ui/format";
import { TOKEN_COLORS } from "../../ui/palette";
import styles from "./Sessions.module.css";

/** 从下往上：缓存读取、缓存写入、输入、输出 */
export const KINDS = [
  { key: "cacheRead", field: "cacheReadTokens" },
  { key: "cacheWrite", field: "cacheCreationTokens" },
  { key: "input", field: "inputTokens" },
  { key: "output", field: "outputTokens" },
] as const;

/** 时刻到秒：14:05:09 */
export function seconds(iso: string): string {
  return `${clock(iso)}:${String(new Date(iso).getSeconds()).padStart(2, "0")}`;
}

/** 纵轴刻度的间隔取 1、2、2.5、5 乘 10 的几次方，看着整齐 */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

const total = (e: ClaudeSessionEntry) => e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens;

interface Props {
  entries: ClaudeSessionEntry[];
  colors: Map<string, string>;
}

export function CallsChart({ entries, colors }: Props) {
  const { t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  /** 悬停在第 i 根柱子上；x 是鼠标在图里的横坐标，w 是图的宽度（摆提示框用） */
  const [hover, setHover] = useState<{ i: number; x: number; w: number } | null>(null);
  const n = entries.length;

  const geo = useMemo(() => {
    const max = entries.reduce((m, e) => Math.max(m, total(e)), 0);
    const step = niceStep(max / 4);
    const top = Math.max(step * Math.ceil(max / step), 1);
    const ticks: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    // 柱子少时留点缝，多了就挨着画（缝比一个像素还窄，留了也看不出来）
    const gap = entries.length <= 80 ? 0.15 : 0;
    const w = 1 - gap;
    const paths = KINDS.map(() => [] as string[]);
    entries.forEach((e, i) => {
      // 坐标系：横轴一根柱子宽 1，纵轴就是 token 数，0 在下面
      let base = top;
      KINDS.forEach((k, j) => {
        const h = e[k.field];
        if (h <= 0) return;
        base -= h;
        paths[j].push(`M${i + gap / 2} ${base}h${w}v${h}h${-w}z`);
      });
    });
    return { top, ticks, d: paths.map((p) => p.join("")) };
  }, [entries]);

  // 横轴放 5 个时刻：开头、四分之一……结尾
  const xTicks = n === 0 ? [] : [...new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4)))];

  const onMove = (e: React.MouseEvent) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || n === 0) return;
    const x = e.clientX - box.left;
    const i = Math.min(n - 1, Math.max(0, Math.floor((x / box.width) * n)));
    setHover((h) => (h && h.i === i && Math.abs(h.x - x) < 1 ? h : { i, x, w: box.width }));
  };

  const cur = hover ? entries[hover.i] : undefined;

  return (
    <div className={`${styles.cc} tnum`}>
      <div className={styles.ccY} aria-hidden="true">
        {geo.ticks.map((v) => (
          <span key={v} style={{ bottom: `${(v / geo.top) * 100}%` }}>
            {tokens(v)}
          </span>
        ))}
      </div>
      <div ref={plotRef} className={styles.ccPlot} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {geo.ticks.map((v) => (
          <span key={v} className={styles.ccGrid} style={{ bottom: `${(v / geo.top) * 100}%` }} />
        ))}
        <Bars d={geo.d} n={n} top={geo.top} />
        {hover && (
          <span
            className={styles.ccHover}
            style={{ left: `${(hover.i / n) * 100}%`, width: `max(2px, ${100 / n}%)` }}
          />
        )}
        {cur && hover && (
          <div
            className={`${styles.tip} ${styles.ccTip}`}
            // 鼠标在右半边时提示框放左边，免得出界
            style={hover.x > hover.w / 2 ? { right: hover.w - hover.x + 12 } : { left: hover.x + 12 }}
          >
            <div className={styles.tipHead}>
              #{hover.i + 1} · {seconds(cur.timestamp)}
            </div>
            <div className={styles.tipRow}>
              <span className={styles.swatch} style={{ background: colors.get(cur.model), width: 8, height: 8 }} />
              <span className={`${styles.tipName} ${styles.mono}`}>{cur.model}</span>
            </div>
            {[...KINDS].reverse().map((k) => (
              <div key={k.key} className={styles.tipRow}>
                <span className={styles.swatch} style={{ background: TOKEN_COLORS[k.key], width: 8, height: 8 }} />
                <span className={styles.tipName}>{t(`blocks.mix.${k.key}`)}</span>
                <span>{cur[k.field].toLocaleString("en-US")}</span>
              </div>
            ))}
            <div className={styles.tipRow} style={{ marginTop: 4, fontWeight: 500 }}>
              <span className={styles.tipName}>{t("chart.total")}</span>
              <span>{total(cur).toLocaleString("en-US")}</span>
            </div>
          </div>
        )}
      </div>
      <span />
      <div className={styles.ccX} aria-hidden="true">
        {xTicks.map((i, k) => (
          <span
            key={i}
            style={{
              left: `${((i + 0.5) / n) * 100}%`,
              // 第一个靠左、最后一个靠右，中间的居中
              transform: k === 0 ? "translateX(-4px)" : k === xTicks.length - 1 ? "translateX(calc(-100% + 4px))" : "translateX(-50%)",
            }}
          >
            {clock(entries[i].timestamp)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 柱子本身：数据不变就不重画（悬停时只有高亮和提示框在变） */
const Bars = memo(function Bars({ d, n, top }: { d: string[]; n: number; top: number }) {
  return (
    <svg className={styles.ccBars} viewBox={`0 0 ${Math.max(n, 1)} ${top}`} preserveAspectRatio="none" aria-hidden="true">
      {KINDS.map((k, j) => (
        <path key={k.key} d={d[j]} fill={TOKEN_COLORS[k.key]} />
      ))}
    </svg>
  );
});
