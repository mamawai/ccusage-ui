// 会话明细：费用、token、调用次数，每次调用的 token（按四类堆叠），最近几次调用。
// 单次调用不显示费用：ccusage 这里只有日志里记录的原始费用，Claude Code 现在不写，基本都是 0
import { useRef } from "react";
import { errorMessage } from "../../ccusage/api";
import type { ClaudeSessionDetail, ClaudeSessionRow } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { duration, money, tokens } from "../../ui/format";
import { TOKEN_COLORS } from "../../ui/palette";
import { Panel } from "../../ui/Panel";
import { projectLabel, type RangeId } from "../overview/data";
import { CallsChart, KINDS, seconds } from "./CallsChart";
import { useSessionDetail } from "./data";
import { sessionMinutes, sessionSpan } from "./SessionList";
import styles from "./Sessions.module.css";

const RECENT = 8;

interface Props {
  session: ClaudeSessionRow;
  range: RangeId;
  colors: Map<string, string>;
}

export function SessionDetail({ session, range, colors }: Props) {
  const { t, lang } = useI18n();
  const { detail, error } = useSessionDetail(session, range);
  // 换到一个没看过的会话、明细还在读时，先淡着显示上一个会话的图，版面不跳
  const last = useRef<{ id: string; detail: ClaudeSessionDetail } | null>(null);
  if (detail) last.current = { id: session.sessionId, detail };
  const shown = detail ? { id: session.sessionId, detail } : last.current;
  const stale = !detail && shown !== null;

  return (
    <Panel title={t("sessions.detail")} delay={180}>
      <div className={`${styles.dHead} tnum`}>
        <span className={styles.dId}>{session.sessionId}</span>
        <span className={styles.small}>
          <span className={styles.mono}>{projectLabel(session.projectPath)}</span> · {sessionSpan(session, lang)} ·{" "}
          {duration(sessionMinutes(session))}
        </span>
      </div>
      <div className={`${styles.dStats} tnum`}>
        <div>
          <span className={styles.label}>{t("sessions.col.cost")}</span>
          <span className={styles.mid}>
            <AnimatedNumber value={session.totalCost} format={money} />
          </span>
        </div>
        <div>
          <span className={styles.label}>{t("sessions.col.tokens")}</span>
          <span className={styles.mid}>{tokens(session.totalTokens)}</span>
        </div>
        <div>
          <span className={styles.label}>{t("sessions.calls")}</span>
          <span className={styles.mid}>{detail ? detail.entries.length : "—"}</span>
        </div>
      </div>

      {detail === null ? (
        <div className={styles.dWait}>{t("sessions.gone")}</div>
      ) : !detail && error !== undefined ? (
        // 这个会话读失败了：报错，不能接着显示上一个会话的图（标题是这个会话，图却是别人的）
        <div className={styles.dWait}>{errorMessage(error, t)}</div>
      ) : !shown ? (
        <div className={styles.dWait}>{t("sessions.detailLoading")}</div>
      ) : (
        // 换了会话，内容淡入一下、柱子重新长出来；同一个会话刷新时不重来
        <div key={shown.id} className={`${styles.swapBody} ${stale ? styles.stale : ""}`}>
          <div className={styles.dSection} style={{ paddingTop: 12 }}>
            <span className={styles.label}>{t("sessions.perCall")}</span>
          </div>
          <CallsChart entries={shown.detail.entries} colors={colors} />
          <div className={styles.legend} style={{ paddingLeft: 16, paddingBottom: 10 }}>
            {[...KINDS].reverse().map((k) => (
              <span key={k.key} className={styles.row} style={{ gap: 6 }}>
                <span className={styles.swatch} style={{ background: TOKEN_COLORS[k.key], width: 8, height: 8 }} />
                {t(`blocks.mix.${k.key}`)}
              </span>
            ))}
          </div>
          <div className={styles.dSection} style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
            <span className={styles.label}>{t("sessions.recent")}</span>
          </div>
          <table className={`${styles.calls} tnum`}>
            <thead>
              <tr>
                <th scope="col">{t("sessions.col.when")}</th>
                <th scope="col">{t("blocks.mix.input")}</th>
                <th scope="col">{t("blocks.mix.output")}</th>
                <th scope="col">{t("blocks.mix.cacheWrite")}</th>
                <th scope="col">{t("blocks.mix.cacheRead")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.detail.entries
                .slice(-RECENT)
                .reverse()
                .map((e, i) => (
                  <tr key={`${e.timestamp}-${i}`}>
                    <td>
                      <span className={styles.modelLine}>
                        <span className={styles.swatch} style={{ background: colors.get(e.model), width: 7, height: 7 }} />
                        {seconds(e.timestamp)}
                      </span>
                    </td>
                    <td>{tokens(e.inputTokens)}</td>
                    <td style={{ color: "var(--ink)" }}>{tokens(e.outputTokens)}</td>
                    <td>{tokens(e.cacheCreationTokens)}</td>
                    <td>{tokens(e.cacheReadTokens)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
