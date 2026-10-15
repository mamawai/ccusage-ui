// 时间线：最近 3 天，每天一行。每行是 24 根小时柱（高度是那个小时花了多少钱），
// 5h 窗口画成柱子后面的圆角底色带，金额标在带子左上角。窗口的起止、金额、柱子都是 ccusage 的数据，口径一致。
// 跨零点的窗口拆成几段，金额只标在看得见的最长那段（明天那段还没有行可画，前天以前的也不画）。点带子就在上面看详情。
// 位置按钟面时间算（几点几分 ÷ 24 小时），夏令时那天、半小时时区下柱子和带子也对得齐
import { dayIso } from "../../ccusage/ledger";
import type { Block } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { clock, money, shortDay } from "../../ui/format";
import { Panel } from "../../ui/Panel";
import styles from "./Blocks.module.css";

const DAYS = 3;

interface Props {
  /** 不含空档，按开始时间从早到晚 */
  blocks: Block[];
  /** 按整点小时分的块（账本里最近 7 天的） */
  hours: Block[];
  selectedId: string;
  liveId: string | undefined;
  now: number;
  onPick: (id: string) => void;
}

/** 时间线上的一天：from、to 是本地的零点（夏令时那天不一定差 24 小时） */
interface Day {
  iso: string;
  ago: number;
  date: Date;
  from: number;
  to: number;
}

function lastDays(): Day[] {
  const today = new Date();
  return Array.from({ length: DAYS }, (_, i) => {
    const ago = DAYS - 1 - i;
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago);
    const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago + 1);
    return { iso: dayIso(date), ago, date, from: date.getTime(), to: next.getTime() };
  });
}

/** 一个时刻在它那天的位置（0–1），按钟面时间算；不在这天里就贴到头或尾 */
function clockFrac(t: number, day: Day): number {
  if (t <= day.from) return 0;
  if (t >= day.to) return 1;
  const d = new Date(t);
  return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24;
}

/** 本地某天某个钟点的键，按小时归桶用 */
const hourKey = (iso: string, hour: number) => `${iso} ${hour}`;

export function Timeline({ blocks, hours, selectedId, liveId, now, onPick }: Props) {
  const { t, lang } = useI18n();
  const days = lastDays();

  // 每个本地钟点花了多少钱：ccusage 的小时块按 UTC 整点切，在半小时时区里起点是 xx:30，归到它所在的那个钟点；
  // 夏令时回拨那天两个小时落在同一个钟点，加起来
  const costAt = new Map<string, number>();
  for (const h of hours) {
    if (h.isGap) continue;
    const d = new Date(h.startTime);
    const key = hourKey(dayIso(d), d.getHours());
    costAt.set(key, (costAt.get(key) ?? 0) + h.costUSD);
  }
  let max = 0;
  for (const day of days) for (let h = 0; h < 24; h++) max = Math.max(max, costAt.get(hourKey(day.iso, h)) ?? 0);

  const spans = blocks.map((b) => ({ block: b, start: Date.parse(b.startTime), end: Date.parse(b.endTime) }));
  // 每个窗口的金额标在哪一天的那段上：看得见的几段里最长的
  const labelDay = new Map<string, string>();
  for (const s of spans) {
    let best = 0;
    for (const day of days) {
      const len = Math.min(s.end, day.to) - Math.max(s.start, day.from);
      if (len > best) {
        best = len;
        labelDay.set(s.block.id, day.iso);
      }
    }
  }
  const spanOf = (id: string | undefined) => spans.find((s) => s.block.id === id);
  const selected = spanOf(selectedId);
  const live = spanOf(liveId);
  const inSpan = (span: typeof selected, at: number) => !!span && at >= span.start && at < span.end;

  return (
    <Panel title={t("blocks.timeline")} sub={t("blocks.timelineSub")} delay={120}>
      <div className={`${styles.tl} tnum`}>
        {days.map((day, row) => {
          const pct = (frac: number) => `${frac * 100}%`;
          let dayCost = 0;
          for (let h = 0; h < 24; h++) dayCost += costAt.get(hourKey(day.iso, h)) ?? 0;

          return (
            <div key={day.iso} className={styles.tlRow}>
              <div className={styles.tlDay}>
                <span>{day.ago === 0 ? t("blocks.today") : day.ago === 1 ? t("blocks.yesterday") : shortDay(day.iso, lang)}</span>
                <b>{money(dayCost)}</b>
              </div>
              <div className={styles.tlTrack}>
                {/* 窗口：柱子后面的底色带，整块可以点 */}
                {spans.map((s) => {
                  if (s.end <= day.from || s.start >= day.to) return null;
                  const left = clockFrac(s.start, day);
                  const right = clockFrac(s.end, day);
                  const cls = [
                    styles.tlBand,
                    s.block.id === selectedId ? styles.tlBandSel : "",
                    s.block.id === liveId ? styles.tlBandLive : "",
                  ].join(" ");
                  return (
                    <button
                      key={s.block.id}
                      className={cls}
                      style={{ left: pct(left), width: pct(right - left) }}
                      onClick={() => onPick(s.block.id)}
                      aria-label={`${clock(s.block.startTime)}–${clock(s.block.endTime)} · ${money(s.block.costUSD)}`}
                    >
                      {labelDay.get(s.block.id) === day.iso && <span className={styles.tlCost}>{money(s.block.costUSD)}</span>}
                    </button>
                  );
                })}

                {/* 24 根小时柱：选中窗口里的用强调色；还没到的小时不画 */}
                <div className={styles.tlBars} aria-hidden="true">
                  {Array.from({ length: 24 }, (_, h) => {
                    const at = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate(), h).getTime();
                    const cost = costAt.get(hourKey(day.iso, h)) ?? 0;
                    if (at > now || cost <= 0) return <span key={h} />;
                    // 用这个小时的正中间判断属于哪个窗口：半小时时区里小时块从 xx:30 开始也判断得对
                    const mid = at + 1_800_000;
                    const cls = inSpan(selected, mid) ? styles.tlBarSel : inSpan(live, mid) ? styles.tlBarLive : undefined;
                    return (
                      <span key={h}>
                        <i
                          className={cls}
                          style={{
                            height: `${Math.max(6, (cost / (max || 1)) * 100)}%`,
                            animationDelay: `${row * 120 + h * 12}ms`,
                          }}
                        />
                      </span>
                    );
                  })}
                </div>

                {day.ago === 0 && <span className={styles.tlNow} style={{ left: pct(clockFrac(now, day)) }} />}
              </div>
            </div>
          );
        })}
        <div className={styles.tlAxis} aria-hidden="true">
          <span className={styles.tlAxisPad} />
          <div>
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
