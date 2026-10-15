// 5h 窗口页（只在 Claude Code 范围里有）：上面是选中的窗口（默认进行中的，没有就最近一个），
// 下面是最近 3 天的时间线、官方 7 天限额每一轮花了多少、全部窗口的表格，点哪个上面就换成哪个。
// 用量从账本里取，限额只用官方数据
import { useMemo, useRef, useState } from "react";
import { errorMessage } from "../../ccusage/api";
import { liveBlock } from "../../ccusage/blocks";
import { useLedger } from "../../ccusage/ledger";
import { useOfficialLimits, useWeekHistory } from "../../ccusage/limits";
import { useI18n } from "../../i18n";
import { ErrorBoundary } from "../../ui/ErrorBoundary";
import { Logo } from "../../ui/Logo";
import { useNow } from "../../ui/useNow";
import { BlockHero } from "./BlockHero";
import { BlockList } from "./BlockList";
import { Timeline } from "./Timeline";
import { WeekWindows } from "./WeekWindows";
import styles from "./Blocks.module.css";

export function BlocksPage() {
  const { t } = useI18n();
  const { ledger, error } = useLedger();
  // 剩余时间、"现在"那条线每 30 秒走一次；到点了块也就算结束
  const now = useNow(30_000);
  // 官方 5h 窗口只在还没到重置时间时用（过了重置时间、新数据还没到时不知道新窗口几点开始）
  const { fiveHour, sevenDay } = useOfficialLimits(now);
  const official = fiveHour && !fiveHour.reset ? fiveHour : undefined;
  // 官方 7 天限额过去几轮结束时的百分比（"7 天窗口"那块估每一轮的额度用）
  const weekHistory = useWeekHistory();
  const [picked, setPicked] = useState<string | null>(null);
  const heroRef = useRef<HTMLElement>(null);

  // ccusage 的配置文件能改排序，这里自己按开始时间排一遍
  const all = useMemo(
    () => (ledger ? [...ledger.blocks].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)) : []),
    [ledger],
  );
  const used = useMemo(() => all.filter((b) => !b.isGap), [all]);

  const header = (
    <div className={styles.head}>
      <h1 className={styles.title}>{t("tab.blocks")}</h1>
    </div>
  );

  if (!ledger) {
    return (
      <div className={styles.page}>
        {header}
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
      </div>
    );
  }

  const live = liveBlock(used, now);
  // 点过的优先；没点过（或者点的那个没了）就看进行中的，再没有就最近一个
  const pickedIndex = used.findIndex((b) => b.id === picked);
  const selIndex = pickedIndex >= 0 ? pickedIndex : live ? used.indexOf(live) : used.length - 1;
  const selected = used[selIndex];

  const pick = (id: string) => {
    setPicked(id);
    // 从下面的表格点上来，把详情滚到能看见的地方
    heroRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className={styles.page}>
      {header}
      {error !== undefined && <p className={styles.warn}>{errorMessage(error, t)}</p>}
      {!selected ? (
        <div className={styles.empty}>{t("blocks.empty")}</div>
      ) : (
        <>
          <ErrorBoundary>
            <BlockHero
              ref={heroRef}
              block={selected}
              live={selected === live}
              official={official}
              now={now}
              fetchedAt={ledger.fetchedAt}
              onPrev={selIndex > 0 ? () => setPicked(used[selIndex - 1].id) : undefined}
              onNext={selIndex < used.length - 1 ? () => setPicked(used[selIndex + 1].id) : undefined}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <Timeline
              blocks={used}
              hours={ledger.hours}
              selectedId={selected.id}
              liveId={live?.id}
              now={now}
              onPick={pick}
            />
          </ErrorBoundary>
          {/* 读到过官方 7 天限额才有：要靠它的重置时间知道每一轮从哪天到哪天 */}
          {sevenDay && (
            <ErrorBoundary>
              <WeekWindows
                sevenDay={sevenDay}
                history={weekHistory}
                blocks={all}
                hours={ledger.hours}
                nonSubscription={ledger.nonSubscription ?? []}
                now={now}
              />
            </ErrorBoundary>
          )}
          <ErrorBoundary>
            <BlockList blocks={all} selectedId={selected.id} liveId={live?.id} official={official} now={now} onPick={pick} />
          </ErrorBoundary>
        </>
      )}
    </div>
  );
}
