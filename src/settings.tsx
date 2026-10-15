// 设置：存在 localStorage。大 Dock 和小 Dock 是两个窗口但同一个来源，共用这份；
// 一个窗口改了，另一个窗口通过 storage 事件马上跟着变
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** 统计范围：Claude Code、全部 Agent，或者某一个 Agent 的 id（codex、gemini……） */
export type Scope = "claude" | "all" | (string & {});

export interface Settings {
  /** online：联网核对价格（和终端里直接跑 ccusage 一致）；builtin：只用 ccusage 内置价格，不联网 */
  priceSource: "online" | "builtin";
  /**
   * 接入 Claude Code 的状态栏，读官方的 5h / 7 天限额（只有订阅有；读不到就不显示限额）。
   * 要改用户的 ~/.claude/settings.json，所以第一次打开时先问（null 就是还没问过）
   */
  officialLimits: boolean | null;
  /** 按周统计时一周从哪天开始，ccusage 默认周日 */
  weekStart: "sunday" | "monday";
  /** 亮暗（大 Dock、小 Dock 一起）：跟随 Windows，或者固定浅色 / 深色 */
  theme: "system" | "light" | "dark";
  /** 显示小 Dock（托盘菜单、小 Dock 上的关闭按钮、设置页都改这个） */
  dockVisible: boolean;
  /** 小 Dock 是否一直在最上层 */
  dockOnTop: boolean;
  /** 点大 Dock 的关闭按钮时：收到托盘（后台继续运行），还是直接退出 */
  closeToTray: boolean;
  scope: Scope;
}

export const DEFAULTS: Settings = {
  priceSource: "online",
  officialLimits: null,
  weekStart: "sunday",
  theme: "system",
  dockVisible: true,
  dockOnTop: true,
  closeToTray: true,
  scope: "claude",
};

const KEY = "ccusage-ui.settings.v1";

function read(): Settings {
  const raw = localStorage.getItem(KEY);
  if (!raw) return DEFAULTS;
  // 存的格式对不上就用默认值；以后新加的设置项，旧数据里没有，也用默认值补上
  try {
    const saved = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    // 去掉了的设置项（计费方式、5h 限额估算、小 Dock 样式），旧数据里的删掉，免得一直写回去
    for (const old of ["billing", "tokenLimit", "dockStyle"]) delete (saved as Record<string, unknown>)[old];
    return saved;
  } catch {
    return DEFAULTS;
  }
}

interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(read);

  // 另一个窗口改了设置
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSettings(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings 必须在 SettingsProvider 里面用");
  return ctx;
}
