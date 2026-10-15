// 统计范围下拉：Claude Code / 全部 Agent / 本机有数据的某个 Agent。
// Agent 列表从本机数据来（全部 Agent 的账本），ccusage 新支持的 Agent 有了数据就会出现
import { useEffect, useMemo, useRef, useState } from "react";
import { agentList, agentName, scopeLabel, useAgents } from "../ccusage/agents";
import { daysAgo, dayIso } from "../ccusage/ledger";
import { useI18n } from "../i18n";
import { useSettings, type Scope } from "../settings";
import { money } from "../ui/format";
import { SERIES } from "../ui/palette";
import styles from "./ScopePicker.module.css";

export function ScopePicker() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { agents, touch } = useAgents();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const scope = settings.scope;

  // 菜单里每个 Agent 近 30 天的费用；顺序按这个从高到低（Claude Code 单独放在最上面）
  const items = useMemo(() => {
    if (!agents) return null;
    const since = dayIso(daysAgo(29));
    const recent = new Map<string, number>();
    let all = 0;
    for (const r of agents.rows) {
      if (r.period < since) continue;
      all += r.totalCost;
      for (const a of r.agents ?? []) recent.set(a.agent, (recent.get(a.agent) ?? 0) + a.totalCost);
    }
    const others = agentList(agents.rows)
      .filter((a) => a.id !== "claude")
      .map((a) => ({ id: a.id, cost: recent.get(a.id) ?? 0, total: a.cost }))
      .sort((a, b) => b.cost - a.cost || b.total - a.total);
    return { all, claude: recent.get("claude") ?? 0, others };
  }, [agents]);

  // 点外面、按 Esc 关掉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: Scope) => {
    update({ scope: next });
    setOpen(false);
  };

  const swatch = (id: Scope, i = 0) =>
    id === "claude" ? (
      <span className={styles.swatch} style={{ background: "var(--accent)" }} />
    ) : id === "all" ? (
      <span className={`${styles.swatch} ${styles.swatchAll}`} />
    ) : (
      <span className={styles.swatch} style={{ background: SERIES[(i + 1) % SERIES.length] }} />
    );
  const otherIndex = items?.others.findIndex((a) => a.id === scope) ?? -1;

  return (
    <div ref={boxRef} className={styles.box}>
      <button
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("scope.label")}
        onClick={() => {
          if (!open) touch();
          setOpen(!open);
        }}
      >
        {swatch(scope, Math.max(0, otherIndex))}
        {scopeLabel(scope, t)}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div role="menu" aria-label={t("scope.label")} className={`${styles.menu} tnum`}>
          <button role="menuitem" className={styles.item} aria-current={scope === "claude"} onClick={() => choose("claude")}>
            {swatch("claude")}
            <span className={styles.name}>{t("scope.claude")}</span>
            <span className={styles.note}>{t("scope.claudeNote")}</span>
          </button>
          <button role="menuitem" className={styles.item} aria-current={scope === "all"} onClick={() => choose("all")}>
            {swatch("all")}
            <span className={styles.name}>{t("scope.all")}</span>
            {items && <span className={styles.cost}>{money(items.all)}</span>}
          </button>
          <div className={styles.group}>{t("scope.others")}</div>
          {!items ? (
            <div className={styles.wait}>{t("scope.loading")}</div>
          ) : (
            items.others.map((a, i) => (
              <button key={a.id} role="menuitem" className={styles.item} aria-current={scope === a.id} onClick={() => choose(a.id)}>
                {swatch(a.id, i)}
                <span className={styles.name}>{agentName(a.id)}</span>
                <span className={styles.cost}>{money(a.cost)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
