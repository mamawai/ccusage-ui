// 调用 Rust 端的 ccusage 命令。所有数据都从这里拿，界面上不自己算费用和 token。
import { invoke } from "@tauri-apps/api/core";
import type { Translate } from "../i18n";
import type {
  AllAgentsReport,
  ClaudeBlocksReport,
  ClaudeDailyReport,
  ClaudeMonthlyReport,
  ClaudeProjectsReport,
  ClaudeSessionDetail,
  ClaudeSessionReport,
  ClaudeWeeklyReport,
  Located,
  ManagerMethod,
  PackageManager,
} from "./types";

/** 各报表通用的选项 */
export interface ReportOptions {
  /** YYYYMMDD */
  since?: string;
  /** YYYYMMDD */
  until?: string;
  /** IANA 时区名，不填跟随系统 */
  timezone?: string;
  /** 用 ccusage 内置价格，不联网拉最新价格 */
  offline?: boolean;
}

export type WeekDay = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
export type Section = "daily" | "weekly" | "monthly" | "session";

/** Rust 端返回的错误；notFound 表示本机没装 ccusage，installFailed 是安装 / 更新 / 回退没成功 */
export type CcusageError =
  | { code: "notFound" }
  | { code: "badRequest" | "failed" | "badOutput" | "installFailed"; message: string };

export function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as CcusageError).code === "notFound";
}

/** 把调用出错的原因变成一句当前语言的话 */
export function errorMessage(e: unknown, t: Translate): string {
  // Tauri 自己的错误（比如参数对不上）是一个字符串
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null && "code" in e) {
    const err = e as CcusageError;
    return err.code === "notFound" ? t("error.notFound") : t(`error.${err.code}`, { detail: err.message });
  }
  // 前端自己的出错（比如查 npm 最新版本时断网）
  if (e instanceof Error) return e.message;
  return t("error.unknown");
}

function report<T>(report: Record<string, unknown>, opts: ReportOptions = {}): Promise<T> {
  return invoke<T>("ccusage_report", { report, opts });
}

/** 找本机的 ccusage */
export const locate = () => invoke<Located>("ccusage_locate");

/** 大 Dock 装完、更新完、重新检测 ccusage 后发给小 Dock：再找一次，接着取账本 */
export const CCUSAGE_CHANGED = "ccusage-changed";

export const claudeDaily = (opts?: ReportOptions) =>
  report<ClaudeDailyReport>({ kind: "claudeDaily" }, opts);

/** 按项目分组；一个项目都没有时 ccusage 返回的是普通日报的形状 */
export const claudeDailyByProject = (opts?: ReportOptions) =>
  report<ClaudeProjectsReport | ClaudeDailyReport>({ kind: "claudeDaily", instances: true }, opts);

export const claudeWeekly = (opts?: ReportOptions, startOfWeek?: WeekDay) =>
  report<ClaudeWeeklyReport>({ kind: "claudeWeekly", startOfWeek }, opts);

export const claudeMonthly = (opts?: ReportOptions) =>
  report<ClaudeMonthlyReport>({ kind: "claudeMonthly" }, opts);

export const claudeSession = (opts?: ReportOptions) =>
  report<ClaudeSessionReport>({ kind: "claudeSession" }, opts);

/** 单个会话的逐次调用；会话不存在时为 null */
export const claudeSessionDetail = (id: string, opts?: ReportOptions) =>
  report<ClaudeSessionDetail | null>({ kind: "claudeSessionDetail", id }, opts);

export interface BlocksOptions {
  /** 块的小时数，默认 5；填 1 就是按整点小时分桶 */
  sessionLength?: number;
}

export const claudeBlocks = (blocks: BlocksOptions, opts?: ReportOptions) =>
  report<ClaudeBlocksReport>({ kind: "claudeBlocks", ...blocks }, opts);

/** 全部 Agent 的合并报表，一次调用拿多个 section */
export const allAgents = (sections: Section[], opts?: ReportOptions) =>
  report<AllAgentsReport>({ kind: "allAgents", sections }, opts);

// ---------- 安装 / 更新 ----------

/** 本机能用来装 ccusage 的包管理器 */
export const managers = () => invoke<PackageManager[]>("ccusage_managers");

/** 用包管理器全局安装某个版本（latest 或具体版本号，回退也用它），返回命令输出 */
export const installWith = (method: ManagerMethod, version: string) =>
  invoke<string>("ccusage_install", { method, version });

/** 自带版：npm 上 @ccusage/ccusage-win32-x64 的下载地址和 sha512 */
export interface BundledDist {
  version: string;
  tarball: string;
  integrity: string;
}

export const installBundled = (dist: BundledDist) =>
  invoke<void>("ccusage_install_bundled", { url: dist.tarball, integrity: dist.integrity });

/** 自带版回退到更新前那份 */
export const rollbackBundled = () => invoke<void>("ccusage_rollback_bundled");

const REGISTRY = "https://registry.npmjs.org";

/** npm 上 ccusage 的最新版本号 */
export async function latestVersion(): Promise<string> {
  const res = await fetch(`${REGISTRY}/ccusage/latest`);
  if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`);
  return ((await res.json()) as { version: string }).version;
}

/** 自带版要下载的包（指定版本，版本号和 ccusage 主包一致）。ccusage-ui 只出 x64 版，所以也下 x64 的 */
export async function bundledDist(version: string): Promise<BundledDist> {
  const res = await fetch(`${REGISTRY}/@ccusage/ccusage-win32-x64/${version}`);
  if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`);
  const json = (await res.json()) as { version: string; dist: { tarball: string; integrity: string } };
  return { version: json.version, tarball: json.dist.tarball, integrity: json.dist.integrity };
}
