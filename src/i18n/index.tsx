// 中英切换：选择存在 localStorage，默认跟随系统；大 Dock、小 Dock 两个窗口通过 storage 事件保持一致
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export type Lang = "zh" | "en";
/** 用户的选择：跟随系统，或固定某种语言 */
export type LangPref = "system" | Lang;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en };
const STORAGE_KEY = "ccusage-ui.lang";

// WebView2 的 navigator.language 跟 Windows 的显示语言一致
function systemLang(): Lang {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function readPref(): LangPref {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "zh" || saved === "en" ? saved : "system";
}

interface I18n {
  /** 实际在用的语言 */
  lang: Lang;
  pref: LangPref;
  setPref: (pref: LangPref) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(readPref);
  const lang = pref === "system" ? systemLang() : pref;

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  // 另一个窗口（大 Dock / 小 Dock）改了语言，这边跟着变
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefState(readPref());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<I18n>(() => {
    const messages = MESSAGES[lang];
    // 把 {name} 换成 params.name，没给的变量原样留着，方便发现漏传
    const t: Translate = (key, params) =>
      messages[key].replace(/\{(\w+)\}/g, (raw, name: string) =>
        params && name in params ? String(params[name]) : raw,
      );
    const setPref = (next: LangPref) => {
      localStorage.setItem(STORAGE_KEY, next);
      setPrefState(next);
    };
    return { lang, pref, setPref, t };
  }, [lang, pref]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n 必须在 I18nProvider 里面用");
  return ctx;
}
