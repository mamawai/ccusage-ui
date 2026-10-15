// 窗口底部的状态栏：在用的 ccusage、有没有新版本、价格核对情况；中文界面下右边还有每日冷知识
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useAgents } from "../ccusage/agents";
import { dayIso, useLedger } from "../ccusage/ledger";
import { useSettings } from "../settings";
import type { Install } from "../ccusage/types";
import { newer } from "../ccusage/versions";
import { useI18n } from "../i18n";
import styles from "./StatusBar.module.css";

interface Props {
  install: Install;
  /** npm 上的最新版本，没查到是 undefined */
  latest: string | undefined;
  /** 点"有新版本"：去设置页更新 */
  onOpenSettings: () => void;
}

export function StatusBar({ install, latest, onOpenSettings }: Props) {
  const { t } = useI18n();
  const { scope } = useSettings().settings;
  const claude = useLedger();
  const agents = useAgents();
  // 价格核对的情况跟着统计范围：看的是哪本账就显示哪本账的
  const prices = scope === "claude" ? claude.prices : agents.prices;
  return (
    <footer className={`${styles.bar} tnum`}>
      <span className={styles.mono}>
        {install.version ? t("status.version", { version: install.version }) : t("status.versionUnknown")}
      </span>
      <span>{t(`method.${install.method}`)}</span>
      {latest && install.version && newer(latest, install.version) && (
        <button className={styles.update} onClick={onOpenSettings}>
          <span className={styles.dot} />
          {t("status.hasNew", { version: latest })}
        </button>
      )}
      {prices === "differ" ? (
        // 内置价格表过时了：每次都联网，提示更新 ccusage
        <span className={styles.warn}>
          {t("status.priceDiffer")}
        </span>
      ) : prices === "builtin" ? (
        <span>{t("status.priceBuiltin")}</span>
      ) : (
        <span>
          {prices === "same" ? t("status.priceChecked") : t("status.priceOnline")}
        </span>
      )}
      <ColdFact />
    </footer>
  );
}

interface Fact {
  content: string;
  /** 分类，比如"食物"；可能是空的 */
  category: string;
}

/**
 * 每日冷知识：接口只有中文，所以只在中文界面显示，英文界面也不请求。
 * 大 Dock 每天第一次打开时取（开机自启时大 Dock 藏着，那时不取）；一天只请求一次由 Rust 端保证，这边多问几次没关系
 */
function ColdFact() {
  const { lang } = useI18n();
  const [fact, setFact] = useState<Fact | null>(null);
  useEffect(() => {
    if (lang !== "zh") return;
    const win = getCurrentWindow();
    const load = async () => {
      if (await win.isVisible()) setFact(await invoke<Fact | null>("cold_fact", { today: dayIso(new Date()) }));
    };
    void load();
    // 从托盘、小 Dock 打开大 Dock 时窗口会获得焦点；过了零点再打开也是在这里换成新的一天
    const stop = win.onFocusChanged(({ payload: focused }) => {
      if (focused) void load();
    });
    return () => {
      stop.then((f) => f());
    };
  }, [lang]);
  if (lang !== "zh" || !fact) return null;
  return (
    <span className={styles.fact}>
      <span aria-hidden="true">💡</span> {fact.category ? `${fact.category}冷知识` : "冷知识"}：{fact.content}
    </span>
  );
}
