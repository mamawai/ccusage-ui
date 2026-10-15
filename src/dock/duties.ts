// 小 Dock 窗口一直开着（大 Dock 收到托盘时会整个关掉），所以常驻的事都放在这里：
// 找 ccusage、托盘菜单的文字、按设置显示 / 隐藏自己、托盘和 Alt+F4 发来的事件
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { CCUSAGE_CHANGED, locate } from "../ccusage/api";
import type { Install } from "../ccusage/types";
import { useI18n } from "../i18n";
import { useSettings } from "../settings";

/** 小 Dock 放过右下角没有；放过以后位置由窗口状态插件记住，用户拖到哪就在哪 */
const PLACED_KEY = "ccusage-ui.dock.placed";

/** 找本机在用的 ccusage；没找到、出错是 null。大 Dock 装完、更新完、重新检测后发 CCUSAGE_CHANGED，这里再找一次 */
export function useCcusage(): Install | null {
  const [install, setInstall] = useState<Install | null>(null);
  useEffect(() => {
    const find = () =>
      locate().then(
        (located) => setInstall(located.active ?? null),
        () => setInstall(null),
      );
    void find();
    const stop = listen(CCUSAGE_CHANGED, () => void find());
    return () => {
      stop.then((f) => f());
    };
  }, []);
  return install;
}

/** ready：找到 ccusage 了才显示小 Dock */
export function useDockDesktop(ready: boolean) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 托盘菜单跟着界面语言
  useEffect(() => {
    void invoke("set_tray_labels", { open: t("tray.open"), dock: t("tray.dock"), quit: t("tray.quit") });
  }, [t]);

  // 按设置显示或隐藏自己，第一次显示放到右下角
  useEffect(() => {
    const visible = ready && settings.dockVisible;
    const place = visible && localStorage.getItem(PLACED_KEY) === null;
    void invoke("set_dock_visible", { visible, place });
    if (place) localStorage.setItem(PLACED_KEY, "1");
  }, [ready, settings.dockVisible]);

  // 托盘菜单点了"显示 / 隐藏小 Dock"
  useEffect(() => {
    const stop = listen("tray-toggle-dock", () => update({ dockVisible: !settingsRef.current.dockVisible }));
    return () => {
      stop.then((f) => f());
    };
  }, [update]);

  // 被 Alt+F4 之类关掉了（Rust 端拦下来只是藏起来）：设置跟着改成不显示，托盘、设置页还能再打开
  useEffect(() => {
    const stop = listen("dock-closed", () => update({ dockVisible: false }));
    return () => {
      stop.then((f) => f());
    };
  }, [update]);
}
