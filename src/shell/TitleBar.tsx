// 自绘标题栏：拖动窗口、页签、窗口按钮（窗口本身去掉了系统边框）
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../i18n";
import { updatedAgo } from "../ui/format";
import { Logo } from "../ui/Logo";
import { useNow } from "../ui/useNow";
import { useAgents } from "../ccusage/agents";
import { useLedger } from "../ccusage/ledger";
import { useSettings } from "../settings";
import styles from "./TitleBar.module.css";

export type Tab = "overview" | "sessions" | "blocks" | "settings";

export const TABS: Tab[] = ["overview", "sessions", "blocks", "settings"];

const appWindow = getCurrentWindow();

interface Props {
  /** 不传就不显示页签（比如还没找到 ccusage 的时候） */
  tab?: Tab;
  onTab?: (tab: Tab) => void;
  /** 显示"x 秒前更新"和刷新按钮 */
  refreshable?: boolean;
}

export function TitleBar({ tab, onTab, refreshable }: Props) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [maximized, setMaximized] = useState(false);
  // 5h 窗口只有 Claude Code 才有：别的统计范围不显示这个页签
  const tabs = settings.scope === "claude" ? TABS : TABS.filter((id) => id !== "blocks");

  useEffect(() => {
    // 最大化以后，中间那个按钮要换成"还原"的图标
    const sync = () => appWindow.isMaximized().then(setMaximized);
    sync();
    const unlisten = appWindow.onResized(sync);
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  return (
    // 带 data-tauri-drag-region 的元素按住可以拖动窗口，双击可以最大化
    <header className={styles.bar} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        <Logo size={18} />
        <span data-tauri-drag-region>ccusage-ui</span>
      </div>

      {tab && onTab && (
        <nav className={styles.tabs} aria-label={t("nav.main")}>
          {tabs.map((id) => (
            <button
              key={id}
              className={styles.tab}
              aria-current={id === tab ? "page" : undefined}
              onClick={() => onTab(id)}
            >
              {t(`tab.${id}`)}
            </button>
          ))}
        </nav>
      )}

      <div className={styles.spacer} data-tauri-drag-region />

      {refreshable && <RefreshControl />}

      <div className={styles.controls}>
        <button className={styles.win} aria-label={t("window.minimize")} onClick={() => appWindow.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M1 6h10" />
          </svg>
        </button>
        <button
          className={styles.win}
          aria-label={maximized ? t("window.restore") : t("window.maximize")}
          onClick={() => appWindow.toggleMaximize()}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="1.5" y="3.5" width="7" height="7" />
              <path d="M3.5 3.5v-2h7v7h-2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button className={`${styles.win} ${styles.close}`} aria-label={t("window.close")} onClick={() => appWindow.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/** "x 秒前更新" + 刷新按钮；正在取数据时按钮转圈。看的不是 Claude Code 时，显示的是全部 Agent 账本的情况 */
function RefreshControl() {
  const { t } = useI18n();
  const { scope } = useSettings().settings;
  const claude = useLedger();
  const agents = useAgents();
  const onClaude = scope === "claude";
  const updatedAt = onClaude ? claude.ledger?.fetchedAt : agents.agents?.fetchedAt;
  const fetching = onClaude ? claude.fetching : agents.fetching;
  const refresh = () => {
    claude.refresh();
    if (!onClaude) agents.refresh();
  };
  const now = useNow(1_000);
  const updated = updatedAt ? updatedAgo(t, updatedAt, now) : "";

  return (
    <div className={styles.refresh}>
      {updated && <span className={`${styles.updated} tnum`}>{updated}</span>}
      <button
        className={`${styles.icon} ${fetching ? styles.spinning : ""}`}
        aria-label={t("action.refresh")}
        onClick={refresh}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 2.5v3h-3" />
        </svg>
      </button>
    </div>
  );
}
