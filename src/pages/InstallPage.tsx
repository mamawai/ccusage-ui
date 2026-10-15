// 没找到 ccusage 时的安装页：一开始只有一个"安装 ccusage"按钮；点了列出能用的安装方式
// （这台电脑上找到的包管理器 + ccusage-ui 自带版），选一个装，装好了就开始用
import { useState } from "react";
import { bundledDist, errorMessage, installBundled, installWith, latestVersion, managers } from "../ccusage/api";
import type { ManagerMethod, PackageManager } from "../ccusage/types";
import { useI18n } from "../i18n";
import { Logo } from "../ui/Logo";
import styles from "./InstallPage.module.css";

type Choice = ManagerMethod | "bundled";

type Step =
  | { kind: "start" }
  | { kind: "finding" }
  | { kind: "choose"; found: PackageManager[] }
  | { kind: "running"; choice: Choice; found: PackageManager[] }
  | { kind: "done"; version: string }
  | { kind: "failed"; error: unknown; found: PackageManager[] };

/** 各包管理器全局安装的命令，显示给用户看 */
const COMMANDS: Record<ManagerMethod, string> = {
  npm: "npm install -g ccusage@latest",
  pnpm: "pnpm add -g ccusage@latest",
  bun: "bun add -g ccusage@latest",
  yarn: "yarn global add ccusage@latest",
};

interface Props {
  /** 装好了：重新找 ccusage，找到了就进主界面 */
  onInstalled: () => Promise<void>;
}

export function InstallPage({ onInstalled }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [pick, setPick] = useState<Choice | null>(null);

  const open = async () => {
    setStep({ kind: "finding" });
    try {
      const found = await managers();
      setStep({ kind: "choose", found });
      // 默认选第一个能用的包管理器，都不能用就选自带版
      setPick(found.find((m) => m.ready)?.method ?? "bundled");
    } catch (error) {
      setStep({ kind: "failed", error, found: [] });
    }
  };

  const install = async (choice: Choice, found: PackageManager[]) => {
    setStep({ kind: "running", choice, found });
    try {
      const version = await latestVersion();
      if (choice === "bundled") await installBundled(await bundledDist(version));
      else await installWith(choice, version);
      setStep({ kind: "done", version });
    } catch (error) {
      setStep({ kind: "failed", error, found });
    }
  };

  if (step.kind === "start") {
    return (
      <button className={styles.primaryBig} onClick={open}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M8 2.5v8" />
          <path d="M4.5 7L8 10.5 11.5 7" />
          <path d="M3 13.5h10" />
        </svg>
        {t("boot.install")}
      </button>
    );
  }

  if (step.kind === "finding") {
    return (
      <div className={styles.wait}>
        <Logo size={40} animated />
        {t("install.finding")}
      </div>
    );
  }

  if (step.kind === "done") {
    return (
      <div className={styles.done}>
        <span className={styles.chip}>{t("install.done", { version: step.version })}</span>
        <button className={styles.primaryBig} onClick={onInstalled}>
          {t("install.start")}
        </button>
      </div>
    );
  }

  const found = step.found;
  const running = step.kind === "running";
  const options: { id: Choice; name: string; note: string; cmd: string; warn?: string; disabled: boolean }[] = [
    ...found.map((m) => ({
      id: m.method,
      name: t(`method.${m.method}`),
      note: t("install.found", { name: m.method, version: m.version ?? "" }),
      cmd: COMMANDS[m.method],
      // 找到了但不能全局安装：pnpm 要先 pnpm setup，yarn 2 以上不支持
      warn: m.ready ? undefined : m.method === "pnpm" ? t("install.pnpmSetup") : t("install.yarnBerry"),
      disabled: !m.ready,
    })),
    { id: "bundled", name: t("install.bundled"), note: t("install.bundledNote"), cmd: t("install.bundledCmd"), disabled: false },
  ];

  return (
    <section className={styles.card} aria-label={t("install.title")}>
      <div className={styles.head}>
        <span className={styles.title}>{t("install.title")}</span>
        <span className={styles.sub}>{t("install.sub")}</span>
      </div>
      <div role="radiogroup" aria-label={t("install.title")} className={styles.options}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={pick === o.id}
            disabled={o.disabled || running}
            className={styles.option}
            onClick={() => setPick(o.id)}
          >
            <span className={styles.radio} />
            <span className={styles.optionText}>
              <span className={styles.optionHead}>
                <span className={styles.optionName}>{o.name}</span>
                <span className={styles.note}>{o.note}</span>
              </span>
              <span className={styles.cmd}>{o.cmd}</span>
              {o.warn && <span className={styles.warn}>{o.warn}</span>}
            </span>
          </button>
        ))}
      </div>
      {step.kind === "failed" && <pre className={styles.log}>{errorMessage(step.error, t)}</pre>}
      <div className={styles.foot}>
        <button className={styles.primary} disabled={!pick || running} onClick={() => pick && install(pick, found)}>
          {running ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              {t("install.running")}
            </>
          ) : (
            t("install.go")
          )}
        </button>
        <button className={styles.ghost} disabled={running} onClick={() => setStep({ kind: "start" })}>
          {t("install.back")}
        </button>
      </div>
    </section>
  );
}
