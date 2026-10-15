// 大 Dock 和桌面的连接：托盘、小 Dock 发来的跳转，关闭时收到托盘还是退出。
// 托盘菜单文字、小 Dock 显示 / 隐藏这些常驻的事归小 Dock 管（见 dock/duties.ts）：大 Dock 收到托盘时整个窗口会关掉
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { useSettings } from "../settings";
import type { Tab } from "./TitleBar";

export function useDesktop(onNavigate: (tab: Tab) => void) {
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 小 Dock 上点了"可更新"之类：切到对应页签（大 Dock 本来就开着时；没开着时 Rust 端新建窗口，页签放在地址里）
  useEffect(() => {
    const stop = listen<Tab>("navigate", (e) => onNavigate(e.payload));
    return () => {
      stop.then((f) => f());
    };
  }, [onNavigate]);

  // 关闭大 Dock（标题栏的关闭、Alt+F4）：按设置收到托盘，或者整个退出。
  // 收到托盘就是真的关掉这个窗口（不只是藏起来），省内存；再打开时 Rust 端重新建。
  // 不收到托盘时要整个退出——只关这个窗口的话小 Dock 还开着，程序退不掉
  useEffect(() => {
    const stop = getCurrentWindow().onCloseRequested((e) => {
      if (settingsRef.current.closeToTray) return;
      e.preventDefault();
      void invoke("app_quit");
    });
    return () => {
      stop.then((f) => f());
    };
  }, []);
}
