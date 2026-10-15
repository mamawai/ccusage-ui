// 全部块：表格，新的在上；空档也列出来（淡一点）。点一行在上面看它的详情
import { useState } from "react";
import { usedMinutes } from "../../ccusage/blocks";
import { daysAgo, dayIso } from "../../ccusage/ledger";
import { minutesLeft, type LimitWindow } from "../../ccusage/limits";
import type { Block } from "../../ccusage/types";
import { useI18n } from "../../i18n";
import { clock, duration, money, shortDay, tokens } from "../../ui/format";
import { Panel } from "../../ui/Panel";
import { Segmented } from "../../ui/Segmented";
import styles from "./Blocks.module.css";

type ListRange = "recent" | "all";

interface Props {
  /** 含空档，按开始时间从早到晚 */
  blocks: Block[];
  selectedId: string;
  liveId: string | undefined;
  /** 官方的 5h 限额：进行中的那一行用它的重置时间算剩多久，没有就不写 */
  official: LimitWindow | undefined;
  now: number;
  onPick: (id: string) => void;
}

export function BlockList({ blocks, selectedId, liveId, official, now, onPick }: Props) {
  const { t, lang } = useI18n();
  const [range, setRange] = useState<ListRange>("recent");
  // "最近 3 天"和时间线对齐：前天 0 点以后还没结束的块
  const from = daysAgo(2).getTime();
  const rows = blocks.filter((b) => range === "all" || Date.parse(b.endTime) > from).reverse();

  const start = (b: Block) => `${shortDay(dayIso(new Date(b.startTime)), lang)} ${clock(b.startTime)}`;

  return (
    <Panel
      title={t("blocks.list")}
      sub={t("blocks.listSub")}
      delay={180}
      actions={
        <Segmented<ListRange>
          label={t("blocks.range")}
          value={range}
          onChange={setRange}
          options={[
            { value: "recent", label: t("blocks.range.recent") },
            { value: "all", label: t("blocks.range.all") },
          ]}
        />
      }
    >
      <div className={styles.tableWrap}>
        <table className={`${styles.table} tnum`}>
          <thead>
            <tr>
              <th className={styles.left} scope="col">{t("blocks.col.start")}</th>
              <th className={styles.left} scope="col">{t("blocks.col.status")}</th>
              <th className={styles.left} scope="col">{t("blocks.col.models")}</th>
              <th scope="col">{t("blocks.col.tokens")}</th>
              <th scope="col">{t("blocks.col.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              if (b.isGap) {
                const len = (Date.parse(b.endTime) - Date.parse(b.startTime)) / 60_000;
                return (
                  <tr key={b.id} className={styles.trGap}>
                    <td className={styles.left}>{start(b)}</td>
                    <td className={styles.left} colSpan={4}>
                      {t("blocks.gap", { d: duration(len) })}
                    </td>
                  </tr>
                );
              }
              const live = b.id === liveId;
              return (
                <tr
                  key={b.id}
                  className={`${styles.tr} ${b.id === selectedId ? styles.trSel : ""}`}
                  onClick={() => onPick(b.id)}
                  onKeyDown={(e) => e.key === "Enter" && onPick(b.id)}
                  tabIndex={0}
                  aria-selected={b.id === selectedId}
                >
                  <td className={styles.left}>{start(b)}</td>
                  <td className={styles.left}>
                    <span className={styles.status}>
                      {live ? (
                        <span className={styles.chip}>
                          {t("block.active")}
                          {official && ` · ${t("blocks.left", { d: duration(minutesLeft(official, now)) })}`}
                        </span>
                      ) : (
                        <span>{duration(usedMinutes(b))}</span>
                      )}
                      {b.usageLimitResetTime && (
                        <span className={styles.chipWarn}>{t("blocks.limitHit", { time: clock(b.usageLimitResetTime) })}</span>
                      )}
                    </span>
                  </td>
                  <td className={`${styles.left} ${styles.modelsCell}`}>
                    <span className={styles.mono}>{b.models.join(", ")}</span>
                  </td>
                  <td>{tokens(b.totalTokens)}</td>
                  <td style={{ fontWeight: 500 }}>{money(b.costUSD)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
