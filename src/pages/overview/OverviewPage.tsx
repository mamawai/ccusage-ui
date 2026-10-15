// 概览页：标题旁边选统计范围（Claude Code / 全部 Agent / 某个 Agent），右边选时间范围。
// Claude Code：指标卡、当前计费块、用量趋势（能按小时）、模型分布、项目排行，数据来自 Claude Code 账本；
// 别的范围：指标卡、用量趋势（全部 Agent 时按 Agent 堆叠）、Agent / 模型分布，数据来自全部 Agent 的账本。
// 切时间范围只是在账本里换一段来算，不再跑 ccusage
import { useMemo, useState } from "react";
import { useAgents } from "../../ccusage/agents";
import { errorMessage } from "../../ccusage/api";
import { liveBlock } from "../../ccusage/blocks";
import { useLedger } from "../../ccusage/ledger";
import { useI18n } from "../../i18n";
import { useSettings } from "../../settings";
import { ScopePicker } from "../../shell/ScopePicker";
import { ErrorBoundary } from "../../ui/ErrorBoundary";
import { Logo } from "../../ui/Logo";
import { Segmented } from "../../ui/Segmented";
import { useNow } from "../../ui/useNow";
import { ActiveBlock } from "./ActiveBlock";
import {
  agentDays,
  agentStackDays,
  allDays,
  argToIso,
  mergeByDate,
  monthSince,
  projectTotals,
  rangeDays,
  rangeSince,
  sumTotals,
  todayIso,
  type RangeId,
} from "./data";
import { Kpis } from "./Kpis";
import { ModelShare } from "./ModelShare";
import { ProjectRank } from "./ProjectRank";
import { UsageChart } from "./UsageChart";
import styles from "./Overview.module.css";

const RANGES: RangeId[] = ["today", "7d", "30d", "month", "all"];

export function OverviewPage() {
  const { t } = useI18n();
  const { scope } = useSettings().settings;
  // 默认看今天
  const [range, setRange] = useState<RangeId>("today");

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{t("tab.overview")}</h1>
          <ScopePicker />
        </div>
        <Segmented<RangeId>
          label={t("overview.range")}
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r, label: t(`overview.range.${r}`) }))}
        />
      </div>
      {scope === "claude" ? <ClaudeView range={range} /> : <AgentsView range={range} scope={scope} />}
    </div>
  );
}

/** 还没有账本：中间放会动的 Logo，出错了就显示原因 */
function Waiting({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <div className={styles.center}>
      {error !== undefined ? (
        <p className={styles.error}>{errorMessage(error, t)}</p>
      ) : (
        <>
          <Logo size={44} animated />
          {t("overview.loading")}
        </>
      )}
    </div>
  );
}

function ClaudeView({ range }: { range: RangeId }) {
  const { t } = useI18n();
  const { ledger, error } = useLedger();
  // 计费块到点就算结束，哪怕账本还没刷新
  const now = useNow(30_000);
  // 过了零点"今天"就换成新的一天，哪怕账本还没刷新（零点后没有新日志时，今天就是 0）
  const today = todayIso();

  // 从账本里取出所选范围和本月的数据
  const view = useMemo(() => {
    if (!ledger) return null;
    const since = rangeSince(range);
    const sinceIso = since ? argToIso(since) : "";
    const rangeRows = ledger.rows.filter((r) => r.date >= sinceIso);
    const monthIso = argToIso(monthSince());
    const monthDays = mergeByDate(ledger.rows.filter((r) => r.date >= monthIso));
    const daily = mergeByDate(rangeRows);
    return {
      daily,
      totals: sumTotals(daily),
      todayCost: monthDays.find((r) => r.date === today)?.totalCost ?? 0,
      monthCost: sumTotals(monthDays).totalCost,
      projects: projectTotals(rangeRows),
    };
  }, [ledger, range, today]);

  // 第一次用、本地还没有账本
  if (!ledger || !view) return <Waiting error={error} />;

  const active = liveBlock(ledger.blocks, now);
  const unpriced = ledger.unpricedModels;

  return (
    <>
      {/* 刷新失败但手里有旧账本时，照常显示，只在上面提示一行 */}
      {error !== undefined && <p className={styles.warn}>{errorMessage(error, t)}</p>}
      {unpriced.length > 0 && (
        <p className={styles.warn}>{t("overview.unpriced", { n: unpriced.length, models: unpriced.join(", ") })}</p>
      )}
      <ErrorBoundary>
        <Kpis
          totals={view.totals}
          todayCost={view.todayCost}
          monthCost={view.monthCost}
          days={rangeDays(range, view.daily)}
        />
      </ErrorBoundary>
      {/* 当前 5h 窗口：官方限额 + 窗口内已用（限额读不到就只有已用；都没有就一行字） */}
      <ErrorBoundary>
        <ActiveBlock block={active} hours={ledger.hours} nonSubscription={ledger.nonSubscription} />
      </ErrorBoundary>
      <ErrorBoundary>
        <UsageChart rows={view.daily} hours={ledger.hours} range={range} />
      </ErrorBoundary>
      <div className={styles.pair}>
        <ErrorBoundary>
          <ModelShare rows={view.daily} />
        </ErrorBoundary>
        <ErrorBoundary>
          <ProjectRank projects={view.projects} />
        </ErrorBoundary>
      </div>
    </>
  );
}

/** 全部 Agent 或者某一个 Agent：没有计费块、项目和按小时，能展示的照常展示 */
function AgentsView({ range, scope }: { range: RangeId; scope: string }) {
  const { t } = useI18n();
  const { agents, error } = useAgents();
  const all = scope === "all";
  // 每分钟看一眼日期：过了零点"今天"换成新的一天
  useNow(60_000);
  const today = todayIso();

  const view = useMemo(() => {
    if (!agents) return null;
    const since = rangeSince(range);
    const sinceIso = since ? argToIso(since) : "";
    const monthIso = argToIso(monthSince());
    const pick = all ? allDays : (rows: typeof agents.rows) => agentDays(rows, scope);
    const rangeRows = agents.rows.filter((r) => r.period >= sinceIso);
    const daily = pick(rangeRows);
    const monthDays = pick(agents.rows.filter((r) => r.period >= monthIso));
    return {
      daily,
      // 全部 Agent 时图表和环形图按 Agent 拆
      byAgent: all ? agentStackDays(rangeRows) : null,
      totals: sumTotals(daily),
      todayCost: monthDays.find((r) => r.date === today)?.totalCost ?? 0,
      monthCost: sumTotals(monthDays).totalCost,
    };
  }, [agents, range, scope, all, today]);

  if (!agents || !view) return <Waiting error={error} />;

  const unpriced = agents.unpricedModels;

  return (
    <>
      {error !== undefined && <p className={styles.warn}>{errorMessage(error, t)}</p>}
      {unpriced.length > 0 && (
        <p className={styles.warn}>{t("overview.unpriced", { n: unpriced.length, models: unpriced.join(", ") })}</p>
      )}
      <ErrorBoundary>
        <Kpis
          totals={view.totals}
          todayCost={view.todayCost}
          monthCost={view.monthCost}
          days={rangeDays(range, view.daily)}
        />
      </ErrorBoundary>
      <ErrorBoundary>
        {/* 别的 Agent 没有按小时的数据，不传 hours 就没有"时"这个粒度 */}
        <UsageChart rows={view.byAgent ?? view.daily} hours={undefined} range={range} byAgent={all} />
      </ErrorBoundary>
      <div className={styles.pair}>
        {view.byAgent && (
          <ErrorBoundary>
            <ModelShare rows={view.byAgent} byAgent />
          </ErrorBoundary>
        )}
        <ErrorBoundary>
          <ModelShare rows={view.daily} delay={all ? 260 : 220} />
        </ErrorBoundary>
      </div>
    </>
  );
}
