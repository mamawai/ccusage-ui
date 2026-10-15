// 小 Dock 窗口的入口（dock.html）。和大 Dock 共用设置、语言、全局样式，但不带图表库，打开快。
// 这个窗口一直开着，取账本这些常驻的事也在这里（见 DockRoot）
import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "../i18n";
import { SettingsProvider } from "../settings";
import { DockRoot } from "./DockApp";
import "../global.css";
// 今日金额用的衬线字（带光学尺寸轴，大字号时笔画更精致）
import "@fontsource-variable/source-serif-4/opsz.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <SettingsProvider>
        <DockRoot />
      </SettingsProvider>
    </I18nProvider>
  </React.StrictMode>,
);
