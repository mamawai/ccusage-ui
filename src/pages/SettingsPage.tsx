// 设置页：ccusage（版本、更新、回退、本机找到的几份）、数据（价格、官方限额、一周从哪天开始、从 CC Switch 导入）、外观与窗口
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState, type ReactNode } from "react";
import { useAgents } from "../ccusage/agents";
import { bundledDist, errorMessage, installBundled, installWith, rollbackBundled } from "../ccusage/api";
import { importFromCcSwitch, type ImportResult } from "../ccusage/archive";
import { useLedger } from "../ccusage/ledger";
import { useOfficialLimits, type HookStatus } from "../ccusage/limits";
import type { Install, Located, ManagerMethod } from "../ccusage/types";
import { newer, type LatestState } from "../ccusage/versions";
import { useI18n, type LangPref } from "../i18n";
import { useSettings, type Settings } from "../settings";
import { useNow } from "../ui/useNow";
import { Panel } from "../ui/Panel";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";
import styles from "./SettingsPage.module.css";

interface Props {
  located: Located;
  /** 重新找 ccusage（装完、更新完、点"重新检测"时） */
  onRelocate: () => Promise<void>;
  /** npm 上的最新版本（大 Dock 启动时查过，6 小时内不重查） */
  latest: LatestState;
  /** 点"检查更新"：马上重新查 */
  onCheckLatest: () => void;
  /** 接入 Claude Code 状态栏的情况（大 Dock 启动时就接上了） */
  limitsHook: { status: HookStatus | null; error: string | null };
}

export function SettingsPage(props: Props) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("tab.settings")}</h1>
      {/* 窗口窄时一块一行占满，宽时排成两列 */}
      <div className={styles.panels}>
        <CcusageSection {...props} />
        <DataSection limitsHook={props.limitsHook} />
        <AppearanceSection />
      </div>
    </div>
  );
}

/** 一行设置：左边名字和说明，右边控件 */
function Row({ name, hint, children }: { name: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span>{name}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

type Job =
  | { kind: "idle" }
  | { kind: "running"; text: string }
  /** 更新成功：prev 是更新前的版本，可以回退 */
  | { kind: "updated"; version: string; prev: string | null }
  | { kind: "rolledBack"; version: string }
  | { kind: "failed"; error: unknown };

function CcusageSection({ located, onRelocate, latest, onCheckLatest }: Props) {
  const { t } = useI18n();
  const ledger = useLedger();
  const agents = useAgents();
  // 进到设置页时就是 ready 状态，一定有在用的那份
  const active = located.active as Install;
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const [relocating, setRelocating] = useState(false);

  const busy = job.kind === "running" || relocating;
  const canUpdate = active.method !== "unknown";
  const hasNew = !!latest.version && !!active.version && newer(latest.version, active.version);

  /** 更新到 target，或者回退到 target（自带版回退是换回留着的旧文件） */
  const apply = async (target: string, rollback: boolean) => {
    const prev = active.version;
    setJob({ kind: "running", text: t(rollback ? "settings.rollingBack" : "settings.updating", { version: target }) });
    try {
      if (active.method === "bundled") {
        if (rollback) await rollbackBundled();
        else await installBundled(await bundledDist(target));
      } else {
        await installWith(active.method as ManagerMethod, target);
      }
      await onRelocate();
      // 换了 ccusage，数据全部重新取一遍
      ledger.refresh();
      agents.refresh();
      setJob(rollback ? { kind: "rolledBack", version: target } : { kind: "updated", version: target, prev });
    } catch (error) {
      setJob({ kind: "failed", error });
    }
  };

  const relocate = async () => {
    setRelocating(true);
    try {
      await onRelocate();
    } finally {
      setRelocating(false);
    }
  };

  return (
    <Panel title={t("settings.ccusage")} sub={t("settings.ccusageSub")} delay={60}>
      <div className={`${styles.body} tnum`}>
        <Row name={t("settings.current")}>
          <span className={styles.value}>
            <b>{active.version ?? "—"}</b> · {t(`method.${active.method}`)}
          </span>
        </Row>
        <Row
          name={t("settings.latest")}
          hint={!canUpdate ? t("settings.unknownMethod") : undefined}
        >
          {latest.checking ? (
            <span className={styles.muted}>{t("settings.checking")}</span>
          ) : latest.error !== undefined ? (
            <span className={styles.warnText}>{errorMessage(latest.error, t)}</span>
          ) : latest.version ? (
            <>
              <b className={styles.value}>{latest.version}</b>
              <span className={hasNew ? styles.chipAccent : styles.chip}>
                {hasNew ? t("settings.hasNew") : t("settings.upToDate")}
              </span>
            </>
          ) : (
            <span className={styles.muted}>—</span>
          )}
          {hasNew && canUpdate && (
            <button className={styles.primary} disabled={busy} onClick={() => apply(latest.version!, false)}>
              {t("settings.update", { version: latest.version! })}
            </button>
          )}
          <button className={styles.ghost} disabled={busy || latest.checking} onClick={onCheckLatest}>
            {t("settings.check")}
          </button>
        </Row>

        {job.kind !== "idle" && (
          <div className={styles.job} aria-live="polite">
            {job.kind === "running" && (
              <span className={styles.row2}>
                <span className={styles.spinner} aria-hidden="true" />
                {job.text}
              </span>
            )}
            {job.kind === "updated" && (
              <span className={styles.row2}>
                <span className={styles.chip}>{t("settings.updated", { version: active.version ?? job.version })}</span>
                {job.prev && (
                  <button className={styles.ghost} onClick={() => apply(job.prev!, true)}>
                    {t("settings.rollback", { version: job.prev })}
                  </button>
                )}
              </span>
            )}
            {job.kind === "rolledBack" && (
              <span className={styles.chip}>{t("settings.rolledBack", { version: active.version ?? job.version })}</span>
            )}
            {job.kind === "failed" && <pre className={styles.log}>{errorMessage(job.error, t)}</pre>}
          </div>
        )}

        <div className={styles.installs}>
          <div className={styles.installsHead}>
            <span className={styles.label}>{t("settings.installs")}</span>
            <button className={styles.ghost} disabled={busy} onClick={relocate}>
              {t("settings.relocate")}
            </button>
          </div>
          {located.all.map((i) => (
            <div key={i.exe} className={styles.install}>
              <span className={styles.row2}>
                <b>{t(`method.${i.method}`)}</b>
                <span className={styles.muted}>{i.version ?? "—"}</span>
                {i.exe === active.exe && <span className={styles.chip}>{t("settings.current")}</span>}
              </span>
              <span className={styles.path}>{i.exe}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function DataSection({ limitsHook }: { limitsHook: Props["limitsHook"] }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const limits = useOfficialLimits(useNow(30_000));
  const { status, error } = limitsHook;

  // 官方限额那一行的说明：还没决定时说接入会做什么；接上了说原来的状态栏照常显示；关着说限额不显示
  const officialHint =
    settings.officialLimits === null
      ? t("limits.ask")
      : !settings.officialLimits
        ? t("settings.officialOff")
        : status?.original
          ? t("settings.officialWrap", { cmd: status.original })
          : t("settings.officialHint");
  // 现在读到的数
  const reading = [
    limits.fiveHour && `5h ${Math.round(limits.fiveHour.usedPercentage)}%`,
    limits.sevenDay && `${t("limits.sevenDayShort")} ${Math.round(limits.sevenDay.usedPercentage)}%`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel title={t("settings.data")} delay={120}>
      <div className={styles.body}>
        <Row name={t("settings.price")} hint={t("settings.priceHint")}>
          <Segmented<Settings["priceSource"]>
            label={t("settings.price")}
            value={settings.priceSource}
            onChange={(priceSource) => update({ priceSource })}
            options={[
              { value: "online", label: t("settings.priceOnline") },
              { value: "builtin", label: t("settings.priceBuiltin") },
            ]}
          />
        </Row>
        <Row name={t("settings.official")} hint={officialHint}>
          {error ? (
            <span className={styles.warnText}>{error}</span>
          ) : (
            settings.officialLimits && (
              <span className={`${styles.muted} tnum`}>{reading || t("settings.officialWaiting")}</span>
            )
          )}
          <Switch
            label={t("settings.official")}
            checked={settings.officialLimits === true}
            onChange={(officialLimits) => update({ officialLimits })}
          />
        </Row>
        <Row name={t("settings.week")}>
          <Segmented<Settings["weekStart"]>
            label={t("settings.week")}
            value={settings.weekStart}
            onChange={(weekStart) => update({ weekStart })}
            options={[
              { value: "sunday", label: t("settings.weekSunday") },
              { value: "monday", label: t("settings.weekMonday") },
            ]}
          />
        </Row>
        <SwitchImport />
      </div>
    </Panel>
  );
}

type ImportJob =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: ImportResult }
  | { kind: "failed"; error: string };

/** 从 CC Switch 导入历史：本机装了 CC Switch 才显示 */
function SwitchImport() {
  const { t } = useI18n();
  const ledger = useLedger();
  const agents = useAgents();
  const [found, setFound] = useState(false);
  const [job, setJob] = useState<ImportJob>({ kind: "idle" });
  useEffect(() => {
    void invoke<string | null>("ccswitch_detect").then((path) => setFound(!!path));
  }, []);
  if (!found) return null;

  const run = async () => {
    setJob({ kind: "running" });
    try {
      const result = await importFromCcSwitch();
      setJob({ kind: "done", result });
      // 存档变了，两本账本重新完整取一次（取完会和存档合并）
      ledger.refresh();
      agents.refresh();
    } catch (e) {
      setJob({ kind: "failed", error: String(e) });
    }
  };

  return (
    <Row name={t("settings.import")} hint={t("settings.importHint")}>
      {job.kind === "done" && (
        <span className={styles.muted}>
          {job.result.days > 0
            ? t("settings.importDone", { n: job.result.days, first: job.result.first ?? "" })
            : t("settings.importNothing")}
        </span>
      )}
      {job.kind === "failed" && <span className={styles.warnText}>{job.error}</span>}
      <button className={styles.ghost} onClick={run} disabled={job.kind === "running"}>
        {job.kind === "running" ? t("settings.importing") : t("settings.importButton")}
      </button>
    </Row>
  );
}

function AppearanceSection() {
  const { t, pref, setPref } = useI18n();
  const { settings, update } = useSettings();
  // 开机自启记在系统里（注册表的启动项），不在设置里；读不到时不显示开关的状态
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, []);
  const toggleAutostart = async (on: boolean) => {
    setAutostart(on);
    try {
      await (on ? enable() : disable());
    } catch {
      setAutostart(await isEnabled().catch(() => null));
    }
  };

  return (
    <Panel title={t("settings.appearance")} delay={180}>
      <div className={styles.body}>
        <Row name={t("settings.language")} hint={t("settings.languageHint")}>
          {/* 中文、English 两个选项不翻译，任何语言下都认得出来 */}
          <Segmented<LangPref>
            label={t("settings.language")}
            value={pref}
            onChange={setPref}
            options={[
              { value: "system", label: t("settings.languageSystem") },
              { value: "zh", label: "中文" },
              { value: "en", label: "English" },
            ]}
          />
        </Row>
        <Row name={t("settings.theme")} hint={t("settings.themeHint")}>
          <Segmented<Settings["theme"]>
            label={t("settings.theme")}
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "system", label: t("settings.themeSystem") },
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
          />
        </Row>
        <Row name={t("settings.showDock")}>
          <Switch label={t("settings.showDock")} checked={settings.dockVisible} onChange={(dockVisible) => update({ dockVisible })} />
        </Row>
        <Row name={t("settings.onTop")}>
          <Switch label={t("settings.onTop")} checked={settings.dockOnTop} onChange={(dockOnTop) => update({ dockOnTop })} />
        </Row>
        <Row name={t("settings.tray")} hint={t("settings.trayHint")}>
          <Switch label={t("settings.tray")} checked={settings.closeToTray} onChange={(closeToTray) => update({ closeToTray })} />
        </Row>
        {autostart !== null && (
          <Row name={t("settings.autostart")} hint={t("settings.autostartHint")}>
            <Switch label={t("settings.autostart")} checked={autostart} onChange={toggleAutostart} />
          </Row>
        )}
      </div>
    </Panel>
  );
}
