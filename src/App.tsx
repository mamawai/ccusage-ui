// 大 Dock 的外壳：先找 ccusage，找到了才显示页签和页面；没找到就显示安装页。
// 账本不在这里取：小 Dock 取好存进 localStorage，这里只读（LedgerMirror / AgentsMirror），大 Dock 关掉也不影响取数
import { emitTo } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { AgentsMirror } from "./ccusage/agents";
import { CCUSAGE_CHANGED, errorMessage, locate } from "./ccusage/api";
import { LedgerMirror } from "./ccusage/ledger";
import { useLimitsHook } from "./ccusage/limits";
import type { Install, Located } from "./ccusage/types";
import { useLatest } from "./ccusage/versions";
import { useI18n } from "./i18n";
import { BlocksPage } from "./pages/blocks/BlocksPage";
import { InstallPage } from "./pages/InstallPage";
import { OverviewPage } from "./pages/overview/OverviewPage";
import { SessionsPage } from "./pages/sessions/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useSettings } from "./settings";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar, type Tab } from "./shell/TitleBar";
import { useDesktop } from "./shell/useDesktop";
import { useTheme } from "./shell/useTheme";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Logo } from "./ui/Logo";
import styles from "./App.module.css";

type Boot =
  | { state: "locating" }
  | { state: "notFound" }
  // 存原始错误，显示时再按当前语言翻译，切语言也能跟着变
  | { state: "failed"; error: unknown }
  | { state: "ready"; located: Located & { active: Install } };

function bootOf(located: Located): Boot {
  return located.active ? { state: "ready", located: { ...located, active: located.active } } : { state: "notFound" };
}

const TABS: Tab[] = ["overview", "sessions", "blocks", "settings"];

/** 窗口是带着页签新建的（比如从小 Dock 点"可更新"打开）：地址里的 ?tab=settings */
function initialTab(): Tab {
  const tab = new URLSearchParams(location.search).get("tab");
  return TABS.find((t) => t === tab) ?? "overview";
}

function App() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const scope = settings.scope;
  useTheme();
  const [boot, setBoot] = useState<Boot>({ state: "locating" });
  const [tab, setTab] = useState<Tab>(initialTab);

  const find = useCallback(async () => {
    setBoot({ state: "locating" });
    try {
      setBoot(bootOf(await locate()));
    } catch (error) {
      setBoot({ state: "failed", error });
    }
  }, []);

  // 装完、更新完、点"重新检测"时重新找：不经过"查找中"，界面不闪；出错交给调用的地方显示。
  // 顺便告诉小 Dock 也重新找，接着取账本
  const relocate = useCallback(async () => {
    setBoot(bootOf(await locate()));
    void emitTo("dock", CCUSAGE_CHANGED);
  }, []);

  useEffect(() => {
    find();
  }, [find]);

  const ready = boot.state === "ready";
  useDesktop(setTab);
  const { latest, check } = useLatest(ready);
  // 接上 / 断开 Claude Code 的状态栏平时由小 Dock 跟着设置做；这里也调一次，拿到现在的情况给设置页显示（重复调没关系）
  const limitsHook = useLimitsHook(settings.officialLimits);

  if (boot.state !== "ready") {
    return (
      <div className={styles.window}>
        <TitleBar />
        <main className={styles.center}>
          {boot.state === "locating" && (
            <>
              <Logo size={56} animated />
              <p className={styles.hint}>{t("boot.locating")}</p>
            </>
          )}

          {boot.state === "notFound" && <InstallPage onInstalled={relocate} />}

          {boot.state === "failed" && (
            <>
              <p className={styles.error}>{t("boot.failed", { detail: errorMessage(boot.error, t) })}</p>
              <button className={styles.secondary} onClick={find}>
                {t("action.retry")}
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  // 5h 窗口只有 Claude Code 才有；换到别的统计范围时，正停在这一页就回到概览
  const shown: Tab = scope !== "claude" && tab === "blocks" ? "overview" : tab;

  return (
    <LedgerMirror>
      <AgentsMirror>
        <div className={styles.window}>
          <TitleBar tab={shown} onTab={setTab} refreshable />
          {/* 第一次打开：接入状态栏要改 Claude Code 的配置，先问一句（设置里随时能改） */}
          {settings.officialLimits === null && (
            <div className={styles.ask}>
              <p>
                <b>{t("limits.askTitle")}</b> {t("limits.ask")}
              </p>
              <button className={styles.askYes} onClick={() => update({ officialLimits: true })}>
                {t("limits.askYes")}
              </button>
              <button className={styles.askNo} onClick={() => update({ officialLimits: false })}>
                {t("limits.askNo")}
              </button>
            </div>
          )}
          <main className={styles.page}>
            {/* 换页签时安全网也跟着换，上一页出的错不会留到下一页 */}
            <ErrorBoundary key={shown}>
              {shown === "overview" ? (
                <OverviewPage />
              ) : shown === "blocks" ? (
                <BlocksPage />
              ) : shown === "sessions" ? (
                <SessionsPage />
              ) : (
                <SettingsPage
                  located={boot.located}
                  onRelocate={relocate}
                  latest={latest}
                  onCheckLatest={() => check(true)}
                  limitsHook={limitsHook}
                />
              )}
            </ErrorBoundary>
          </main>
          <StatusBar install={boot.located.active} latest={latest.version} onOpenSettings={() => setTab("settings")} />
        </div>
      </AgentsMirror>
    </LedgerMirror>
  );
}

export default App;
