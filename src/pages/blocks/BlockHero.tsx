// 选中的那个 5h 窗口：左边时间和基本数字，中间窗口内累计 token 曲线，
// 右边进行中的窗口看燃烧速率和官方 5h 限额，结束了的窗口看 token 构成
import { forwardRef } from "react";
import { BURN_COLOR, burnLevel, usedMinutes } from "../../ccusage/blocks";
import { dayIso } from "../../ccusage/ledger";
import { fiveHourElapsed, fiveHourStart, minutesLeft, resetIso, type LimitWindow } from "../../ccusage/limits";
import type { Block } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { clock, duration, longDay, money, tokens } from "../../ui/format";
import { Meter } from "../../ui/Meter";
import { SERIES, TOKEN_COLORS } from "../../ui/palette";
import { BlockCurve } from "./BlockCurve";
import styles from "./Blocks.module.css";

interface Props {
  block: Block;
  live: boolean;
  /** 官方的 5h 限额（Claude Code 给的）；读不到就没有，进行中的窗口也就不显示时间和限额 */
  official: LimitWindow | undefined;
  now: number;
  /** 账本刷新时间：进行中的块拿它判断要不要重读曲线 */
  fetchedAt: number;
  onPrev?: () => void;
  onNext?: () => void;
}

export const BlockHero = forwardRef<HTMLElement, Props>(function BlockHero(
  { block, live, official, now, fetchedAt, onPrev, onNext },
  ref,
) {
  const { t, lang } = useI18n();
  const start = Date.parse(block.startTime);
  const end = Date.parse(block.endTime);
  const used = usedMinutes(block);
  // 进行中的窗口只认官方给的时间
  const limit = live ? official : undefined;

  return (
    <section ref={ref} className={`${styles.hero} tnum`} aria-label={live ? t("block.title") : t("blocks.block")}>
      <div className={styles.heroInfo}>
        <div className={styles.heroHead}>
          <h2 className={styles.heroTitle}>{live ? t("block.title") : t("blocks.block")}</h2>
          <span className={live ? styles.chip : styles.chipMuted}>{live ? t("block.active") : t("blocks.ended")}</span>
          <div className={styles.nav}>
            <button className={styles.navBtn} onClick={onPrev} disabled={!onPrev} aria-label={t("blocks.prev")}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M7.5 2.5L4 6l3.5 3.5" />
              </svg>
            </button>
            <button className={styles.navBtn} onClick={onNext} disabled={!onNext} aria-label={t("blocks.next")}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4.5 2.5L8 6 4.5 9.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* 换了块，内容淡入一下 */}
        <div key={block.id} className={styles.swapBody}>
          <span className={styles.small}>{longDay(dayIso(new Date(start)), lang)}</span>
          {limit ? (
            <>
              <span className={styles.range}>
                {clock(fiveHourStart(limit))} – {clock(resetIso(limit))}
              </span>
              <Meter ratio={fiveHourElapsed(limit, now)} />
              <span className={styles.small}>
                {t("block.time", {
                  elapsed: duration(300 - minutesLeft(limit, now)),
                  left: duration(minutesLeft(limit, now)),
                })}
              </span>
            </>
          ) : live ? (
            // 读不到官方数据：不知道几点重置，只写什么时候开始的
            <>
              <span className={styles.range}>{t("blocks.since", { time: clock(block.startTime) })}</span>
              <span className={styles.small}>{t("blocks.activeFor", { d: duration(used) })}</span>
            </>
          ) : (
            <>
              <span className={styles.range}>
                {clock(block.startTime)} – {clock(block.endTime)}
              </span>
              <Meter ratio={used / ((end - start) / 60_000)} color="var(--ink-3)" />
              <span className={styles.small}>{t("blocks.activeFor", { d: duration(used) })}</span>
            </>
          )}
          <dl className={styles.facts}>
            <dt>{t("blocks.cost")}</dt>
            <dd style={{ fontWeight: 500 }}>
              <AnimatedNumber value={block.costUSD} format={money} /> · {tokens(block.totalTokens)}
            </dd>
            <dt>{t("blocks.calls")}</dt>
            <dd>{t("blocks.callsN", { n: block.entries })}</dd>
            <dt>{t("blocks.models")}</dt>
            <dd className={styles.models}>
              {block.models.map((m) => (
                <span key={m} className={styles.mono}>
                  {m}
                </span>
              ))}
            </dd>
          </dl>
          {block.usageLimitResetTime && (
            <span className={styles.chipWarn}>{t("blocks.limitHit", { time: clock(block.usageLimitResetTime) })}</span>
          )}
        </div>
      </div>

      <figure className={styles.heroCurve} style={{ margin: 0 }}>
        <div className={styles.curveHead}>
          <span className={styles.curveTitle}>{t("blocks.curve")}</span>
          <span className={styles.curveLegend}>
            <span className={styles.row} style={{ gap: 6 }}>
              <span style={{ width: 14, height: 2, background: SERIES[1] }} />
              {t("blocks.actual")}
            </span>
          </span>
        </div>
        <BlockCurve key={block.id} block={block} version={live ? fetchedAt : 0} live={live} now={now} />
      </figure>

      <div className={styles.heroSide}>
        {live && (block.burnRate || limit) ? (
          <>
            {block.burnRate && <Burn block={block} />}
            {limit && <Limit w={limit} now={now} />}
          </>
        ) : (
          <Mix key={`mix-${block.id}`} block={block} />
        )}
      </div>
    </section>
  );
});

/** 燃烧速率：每小时多少钱 + 三档刻度条（档位和 ccusage 一样按不含缓存的 token/分钟分） */
function Burn({ block }: { block: Block }) {
  const { t } = useI18n();
  const rate = block.burnRate!;
  const v = rate.tokensPerMinuteForIndicator;
  const level = burnLevel(v);
  // 三档各占三分之一：0–2K、2K–5K、5K 以上（画到 10K 为止）
  const pos = v < 2000 ? v / 2000 / 3 : v < 5000 ? 1 / 3 + (v - 2000) / 3000 / 3 : 2 / 3 + Math.min(1, (v - 5000) / 5000) / 3;

  return (
    <div className={styles.sideBlock}>
      <span className={styles.label}>{t("block.burn")}</span>
      <span className={styles.mid}>
        <AnimatedNumber value={rate.costPerHour} format={money} />
        <span className={styles.unit}> {t("block.perHour")}</span>
      </span>
      <div role="img" aria-label={t(`block.burn.${level}`)}>
        <div className={styles.gauge}>
          <div style={{ background: "var(--gauge-ok)" }} />
          <div style={{ background: "var(--gauge-warn)" }} />
          <div style={{ background: "var(--gauge-high)" }} />
          <div className={styles.gaugeMark} style={{ left: `${pos * 100}%` }} />
        </div>
        <div className={styles.gaugeScale} style={{ marginTop: 4 }}>
          <span>{t("block.burn.ok")}</span>
          <span>{t("block.burn.warn")} 2K</span>
          <span>{t("block.burn.high")} 5K</span>
        </div>
      </div>
      <span className={styles.small}>{t("blocks.burnSub", { a: tokens(v), b: tokens(rate.tokensPerMinute) })}</span>
    </div>
  );
}

/** 官方的 5h 限额：用了百分之几、进度条、几点重置 */
function Limit({ w, now }: { w: LimitWindow; now: number }) {
  const { t } = useI18n();
  const ratio = w.usedPercentage / 100;
  return (
    <div className={styles.sideBlock}>
      <span className={styles.label}>{t("limits.fiveHour")}</span>
      <span className={styles.mid}>
        <AnimatedNumber value={w.usedPercentage} format={(v) => `${Math.round(v)}%`} />
      </span>
      <Meter ratio={ratio} color={ratio >= 1 ? BURN_COLOR.high : "var(--accent)"} />
      <span className={styles.small}>
        {t("limits.resetIn", { d: duration(minutesLeft(w, now)), time: clock(resetIso(w)) })}
      </span>
    </div>
  );
}

/** Token 构成：输入、输出、缓存写入、缓存读取各占多少 */
function Mix({ block }: { block: Block }) {
  const { t } = useI18n();
  const c = block.tokenCounts;
  const parts = [
    { key: "input", value: c.inputTokens, color: TOKEN_COLORS.input },
    { key: "output", value: c.outputTokens, color: TOKEN_COLORS.output },
    { key: "cacheWrite", value: c.cacheCreationInputTokens, color: TOKEN_COLORS.cacheWrite },
    { key: "cacheRead", value: c.cacheReadInputTokens, color: TOKEN_COLORS.cacheRead },
  ] as const;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;

  return (
    <div className={styles.sideBlock}>
      <span className={styles.label}>{t("blocks.mix")}</span>
      <div className={styles.mix}>
        {parts.map(
          (p, i) =>
            p.value > 0 && (
              <div
                key={p.key}
                className={styles.mixPart}
                // 太小的也给 2px，看得见
                style={{ flex: `${p.value / total} 0 2px`, background: p.color, animationDelay: `${i * 60}ms` }}
              />
            ),
        )}
      </div>
      <div className={styles.mixLegend}>
        {parts.map((p) => (
          <span key={p.key}>
            <span className={styles.swatch} style={{ background: p.color, width: 8, height: 8 }} />
            {t(`blocks.mix.${p.key}`)}
            <b>{tokens(p.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
