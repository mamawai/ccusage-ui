// 别的 Agent 的会话列表（简化版）：ccusage 的统一报表只给每个会话的合计和最后活动时间，
// 没有逐次调用，所以没有明细，点不开
import { useEffect, useState } from "react";
import { agentName } from "../../ccusage/agents";
import { dayIso } from "../../ccusage/ledger";
import type { AllAgentsRow } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { clock, money, shortDay, tokens } from "../../ui/format";
import { Panel } from "../../ui/Panel";
import { Segmented } from "../../ui/Segmented";
import { shortSessionId } from "./data";
import type { SortBy } from "./SessionList";
import styles from "./Sessions.module.css";

const PAGE = 20;

interface Props {
  /** 已经按搜索过滤、排好序的 */
  rows: AllAgentsRow[];
  sort: SortBy;
  onSort: (sort: SortBy) => void;
  colors: Map<string, string>;
  /** 只看一个 Agent 时不用每行都写 Agent 名 */
  showAgent: boolean;
  resetKey: string;
}

export function AgentSessionList({ rows, sort, onSort, colors, showAgent, resetKey }: Props) {
  const { t, lang } = useI18n();
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [resetKey, sort]);

  const max = rows.reduce((m, r) => Math.max(m, r.totalCost), 0) || 1;
  const page = rows.slice(0, shown);

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
      {rows.length === 0 ? (
        <div className={styles.empty}>{t("sessions.noMatch")}</div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} tnum`}>
              <thead>
                <tr>
                  <th className={styles.left} scope="col">
                    {showAgent ? t("sessions.col.agentSession") : t("sessions.col.session")}
                  </th>
                  <th className={styles.left} scope="col">{t("sessions.col.last")}</th>
                  <th scope="col">{t("sessions.col.tokens")}</th>
                  <th scope="col">{t("sessions.col.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r, i) => {
                  const last = r.metadata?.lastActivity;
                  return (
                    <tr key={`${r.agent}|${r.period}`}>
                      <td className={styles.left}>
                        <div className={styles.stack}>
                          <span className={styles.sidLine}>
                            <span className={styles.sid}>
                              {shortSessionId(r.period)}
                            </span>
                            <span className={styles.dots}>
                              {r.modelsUsed.map((m) => (
                                <span key={m} style={{ background: colors.get(m) }} />
                              ))}
                            </span>
                          </span>
                          {showAgent && <span className={styles.small}>{agentName(r.agent)}</span>}
                        </div>
                      </td>
                      <td className={styles.left}>
                        {last ? `${shortDay(dayIso(new Date(last)), lang)} ${clock(last)}` : "—"}
                      </td>
                      <td>{tokens(r.totalTokens)}</td>
                      <td>
                        <span className={styles.costCell}>
                          <span className={styles.costBar} aria-hidden="true">
                            <span style={{ width: `${(r.totalCost / max) * 100}%`, animationDelay: `${Math.min(i, 20) * 25}ms` }} />
                          </span>
                          {money(r.totalCost)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`${styles.foot} tnum`}>
            <span>{t("sessions.shown", { n: page.length, total: rows.length })}</span>
            {shown < rows.length && (
              <button className={styles.more} onClick={() => setShown((n) => n + PAGE)}>
                {t("sessions.more", { n: Math.min(PAGE, rows.length - shown) })}
              </button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
