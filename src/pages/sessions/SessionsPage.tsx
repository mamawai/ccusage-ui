// 会话页：标题旁边选统计范围，右边搜索和时间范围。
// Claude Code：汇总、会话列表、选中会话的明细（逐次调用）；列表按时间范围交给 ccusage 取。
// 别的范围：汇总和会话列表（ccusage 的统一报表没有逐次调用，所以没有明细）。搜索、排序只在取到的列表里做
import { useMemo, useRef, useState } from "react";
import { agentName } from "../../ccusage/agents";
import { errorMessage } from "../../ccusage/api";
import { useLedger } from "../../ccusage/ledger";
import type { ClaudeSessionRow } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { useSettings } from "../../settings";
import { ScopePicker } from "../../shell/ScopePicker";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { ErrorBoundary } from "../../ui/ErrorBoundary";
import { money, percent, tokens } from "../../ui/format";
import { Logo } from "../../ui/Logo";
import { Segmented } from "../../ui/Segmented";
import type { RangeId } from "../overview/data";
import { AgentSessionList } from "./AgentSessionList";
import { median, modelColors, prefetchSessionDetail, useAgentSessions, useSessions } from "./data";
import { SessionDetail } from "./SessionDetail";
import { SessionList, type SortBy } from "./SessionList";
import styles from "./Sessions.module.css";

const RANGES: RangeId[] = ["today", "7d", "30d", "month", "all"];

export function SessionsPage() {
  const { t } = useI18n();
  const { scope } = useSettings().settings;
  // 默认看今天的会话
  const [range, setRange] = useState<RangeId>("today");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortBy>("cost");
  const onClaude = scope === "claude";
  const q = query.trim().toLowerCase();

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{t("tab.sessions")}</h1>
          <ScopePicker />
        </div>
        <div className={styles.tools}>
          <label className={styles.search}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={onClaude ? t("sessions.search") : t("sessions.searchAgents")}
              aria-label={onClaude ? t("sessions.search") : t("sessions.searchAgents")}
              spellCheck={false}
            />
          </label>
          <Segmented<RangeId>
            label={t("overview.range")}
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ value: r, label: t(`overview.range.${r}`) }))}
          />
        </div>
      </div>
      {onClaude ? (
        <ClaudeSessions range={range} q={q} sort={sort} onSort={setSort} />
      ) : (
        <AgentSessions range={range} q={q} sort={sort} onSort={setSort} scope={scope} />
      )}
    </div>
  );
}

interface ViewProps {
  range: RangeId;
  /** 搜索词，已经转成小写 */
  q: string;
  sort: SortBy;
  onSort: (sort: SortBy) => void;
}

/** 还没取到列表：中间放会动的 Logo，出错了就显示原因 */
function Waiting({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <div className={styles.center}>
      {error !== undefined ? (
        <p className={styles.error}>{errorMessage(error, t)}</p>
      ) : (
        <>
          <Logo size={44} animated />
          {t("sessions.loading")}
        </>
      )}
    </div>
  );
}

function ClaudeSessions({ range, q, sort, onSort }: ViewProps) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  const { report, error } = useSessions(range);
  const { offline } = useLedger();

  const sessions = useMemo(() => report?.sessions ?? [], [report]);
  const colors = useMemo(() => modelColors(sessions), [sessions]);
  const list = useMemo(() => {
    const hit = q
      ? sessions.filter((s) => s.sessionId.toLowerCase().includes(q) || s.projectPath.toLowerCase().includes(q))
      : sessions;
    return [...hit].sort((a, b) =>
      sort === "cost" ? b.totalCost - a.totalCost : Date.parse(b.lastActivity) - Date.parse(a.lastActivity),
    );
  }, [sessions, q, sort]);

  if (!report) return <Waiting error={error} />;

  // 点过的优先；没点过（或者点的那个不在这个范围里）就看最近活动的那个
  const selected =
    sessions.find((s) => s.sessionId === picked) ??
    sessions.reduce<ClaudeSessionRow | undefined>(
      (a, s) => (!a || Date.parse(s.lastActivity) > Date.parse(a.lastActivity) ? s : a),
      undefined,
    );

  const pick = (id: string) => {
    setPicked(id);
    // 窄窗口时明细在列表上面，滚到能看见
    asideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      {error !== undefined && <p className={styles.warn}>{errorMessage(error, t)}</p>}
      {sessions.length === 0 ? (
        <div className={styles.empty}>{t("sessions.empty")}</div>
      ) : (
        <>
          <ErrorBoundary>
            <Kpis rows={list} groups={t("sessions.kpi.countSub", { n: new Set(list.map((s) => s.projectPath)).size })} />
          </ErrorBoundary>
          <div className={styles.split}>
            <ErrorBoundary>
              <SessionList
                sessions={list}
                sort={sort}
                onSort={onSort}
                colors={colors}
                selectedId={selected?.sessionId}
                onPick={pick}
                onDwell={(s) => prefetchSessionDetail(s, range, offline)}
                resetKey={`${range}|${q}`}
              />
            </ErrorBoundary>
            <div ref={asideRef} className={styles.aside}>
              {selected && (
                <ErrorBoundary>
                  <SessionDetail session={selected} range={range} colors={colors} />
                </ErrorBoundary>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function AgentSessions({ range, q, sort, onSort, scope }: ViewProps & { scope: string }) {
  const { t } = useI18n();
  const { rows, error } = useAgentSessions(range);
  const all = scope === "all";

  const sessions = useMemo(() => (rows ?? []).filter((r) => all || r.agent === scope), [rows, all, scope]);
  const colors = useMemo(() => modelColors(sessions), [sessions]);
  const list = useMemo(() => {
    const hit = q
      ? sessions.filter((r) => r.period.toLowerCase().includes(q) || agentName(r.agent).toLowerCase().includes(q))
      : sessions;
    // 有的 Agent 不记最后活动时间，按时间排时放到最后
    const last = (r: (typeof hit)[number]) => (r.metadata?.lastActivity ? Date.parse(r.metadata.lastActivity) : 0);
    return [...hit].sort((a, b) => (sort === "cost" ? b.totalCost - a.totalCost : last(b) - last(a)));
  }, [sessions, q, sort]);

  if (!rows) return <Waiting error={error} />;

  const groups = all
    ? t("sessions.kpi.agentsSub", { n: new Set(list.map((r) => r.agent)).size })
    : t("sessions.kpi.modelsSub", { n: new Set(list.flatMap((r) => r.modelsUsed)).size });

  return (
    <>
      {error !== undefined && <p className={styles.warn}>{errorMessage(error, t)}</p>}
      {sessions.length === 0 ? (
        <div className={styles.empty}>{t("sessions.empty")}</div>
      ) : (
        <>
          <ErrorBoundary>
            <Kpis rows={list} groups={groups} />
          </ErrorBoundary>
          <ErrorBoundary>
            <AgentSessionList
              rows={list}
              sort={sort}
              onSort={onSort}
              colors={colors}
              showAgent={all}
              resetKey={`${range}|${q}|${scope}`}
            />
          </ErrorBoundary>
        </>
      )}
    </>
  );
}

/** 汇总：会话数、总费用、平均和中位数、最贵的一个（都是 ccusage 给的每个会话的数字相加、比较） */
function Kpis({ rows, groups }: { rows: { totalCost: number; totalTokens: number }[]; groups: string }) {
  const { t } = useI18n();
  const cost = rows.reduce((a, s) => a + s.totalCost, 0);
  const tok = rows.reduce((a, s) => a + s.totalTokens, 0);
  const top = rows.reduce((m, s) => Math.max(m, s.totalCost), 0);
  const n = rows.length;

  return (
    <section className={`${styles.kpis} tnum`} aria-label={t("overview.kpis")}>
      <div className={styles.kpi}>
        <span className={styles.label}>{t("sessions.kpi.count")}</span>
        <span className={styles.big}>
          <AnimatedNumber value={n} format={(v) => String(Math.round(v))} />
        </span>
        <span className={styles.small}>{groups}</span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.label}>{t("sessions.kpi.cost")}</span>
        <span className={styles.big}>
          <AnimatedNumber value={cost} format={money} />
        </span>
        <span className={styles.small}>{t("chart.tokens", { n: tokens(tok) })}</span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.label}>{t("sessions.kpi.avg")}</span>
        <span className={styles.big}>
          <AnimatedNumber value={n > 0 ? cost / n : 0} format={money} />
        </span>
        <span className={styles.small}>
          {t("sessions.kpi.median", { value: money(median(rows.map((s) => s.totalCost))) })}
        </span>
      </div>
      <div className={styles.kpi}>
        <span className={styles.label}>{t("sessions.kpi.top")}</span>
        <span className={styles.big}>
          <AnimatedNumber value={top} format={money} />
        </span>
        <span className={styles.small}>{t("sessions.kpi.topShare", { pct: percent(cost > 0 ? top / cost : 0) })}</span>
      </div>
    </section>
  );
}
