// 会话列表：按费用或按时间排，每行带一根费用小横条（和列表里最贵的比）；点一行看明细
import { useEffect, useRef, useState } from "react";
import { dayIso } from "../../ccusage/ledger";
import type { ClaudeSessionRow } from "../../ccusage/types";
import { useI18n, type Lang } from "../../i18n";
import { clock, duration, money, shortDay, tokens } from "../../ui/format";
import { Panel } from "../../ui/Panel";
import { Segmented } from "../../ui/Segmented";
import { projectLabel } from "../overview/data";
import styles from "./Sessions.module.css";

export type SortBy = "cost" | "recent";

const PAGE = 20;

interface Props {
  /** 已经按搜索过滤、排好序的 */
  sessions: ClaudeSessionRow[];
  sort: SortBy;
  onSort: (sort: SortBy) => void;
  colors: Map<string, string>;
  selectedId: string | undefined;
  onPick: (id: string) => void;
  /** 鼠标在某行上停了一会儿（拿来预读明细） */
  onDwell: (session: ClaudeSessionRow) => void;
  /** 时间范围或搜索变了，列表回到第一页 */
  resetKey: string;
}

const DWELL_MS = 150;

/** 会话的起止：同一天只写一次日期 */
export function sessionSpan(s: ClaudeSessionRow, lang: Lang): string {
  const first = new Date(s.firstActivity);
  const last = new Date(s.lastActivity);
  const d1 = dayIso(first);
  const d2 = dayIso(last);
  const head = `${shortDay(d1, lang)} ${clock(s.firstActivity)}`;
  return d1 === d2 ? `${head} – ${clock(s.lastActivity)}` : `${head} – ${shortDay(d2, lang)} ${clock(s.lastActivity)}`;
}

export function sessionMinutes(s: ClaudeSessionRow): number {
  return (Date.parse(s.lastActivity) - Date.parse(s.firstActivity)) / 60_000;
}

export function SessionList({ sessions, sort, onSort, colors, selectedId, onPick, onDwell, resetKey }: Props) {
  const { t, lang } = useI18n();
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [resetKey, sort]);
  // 鼠标只是划过去不算，停够 150ms 才预读，免得一下子起一堆 ccusage
  const dwell = useRef<number | null>(null);
  const leave = () => {
    if (dwell.current !== null) window.clearTimeout(dwell.current);
    dwell.current = null;
  };
  useEffect(() => leave, []);

  const max = sessions.reduce((m, s) => Math.max(m, s.totalCost), 0) || 1;
  const rows = sessions.slice(0, shown);

  return (
    <Panel
      title={t("sessions.list")}
      delay={120}
      actions={
        <Segmented<SortBy>
          label={t("sessions.sort")}
          value={sort}
          onChange={onSort}
          options={[
            { value: "cost", label: t("sessions.sort.cost") },
            { value: "recent", label: t("sessions.sort.recent") },
          ]}
        />
      }
    >
      {sessions.length === 0 ? (
        <div className={styles.empty}>{t("sessions.noMatch")}</div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} tnum`}>
              <thead>
                <tr>
                  <th className={styles.left} scope="col">{t("sessions.col.session")}</th>
                  <th className={styles.left} scope="col">{t("sessions.col.time")}</th>
                  <th scope="col">{t("sessions.col.tokens")}</th>
                  <th scope="col">{t("sessions.col.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr
                    key={s.sessionId}
                    className={`${styles.tr} ${s.sessionId === selectedId ? styles.trSel : ""}`}
                    onClick={() => onPick(s.sessionId)}
                    onKeyDown={(e) => e.key === "Enter" && onPick(s.sessionId)}
                    onMouseEnter={() => {
                      leave();
                      dwell.current = window.setTimeout(() => onDwell(s), DWELL_MS);
                    }}
                    onMouseLeave={leave}
                    tabIndex={0}
                  >
                    <td className={styles.left}>
                      <div className={styles.stack}>
                        <span className={styles.sidLine}>
                          <span className={styles.sid}>{s.sessionId.slice(0, 8)}</span>
                          <span className={styles.dots}>
                            {s.modelsUsed.map((m) => (
                              <span key={m} style={{ background: colors.get(m) }} />
                            ))}
                          </span>
                        </span>
                        <span className={styles.project}>
                          {projectLabel(s.projectPath)}
                        </span>
                      </div>
                    </td>
                    <td className={styles.left}>
                      <div className={styles.stack}>
                        <span>{sessionSpan(s, lang)}</span>
                        <span className={styles.small}>{duration(sessionMinutes(s))}</span>
                      </div>
                    </td>
                    <td>{tokens(s.totalTokens)}</td>
                    <td>
                      <span className={styles.costCell}>
                        <span className={styles.costBar} aria-hidden="true">
                          <span style={{ width: `${(s.totalCost / max) * 100}%`, animationDelay: `${Math.min(i, 20) * 25}ms` }} />
                        </span>
                        {money(s.totalCost)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${styles.foot} tnum`}>
            <span>{t("sessions.shown", { n: rows.length, total: sessions.length })}</span>
            {shown < sessions.length && (
              <button className={styles.more} onClick={() => setShown((n) => n + PAGE)}>
                {t("sessions.more", { n: Math.min(PAGE, sessions.length - shown) })}
              </button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
