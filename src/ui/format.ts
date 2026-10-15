// 数字、日期的显示格式。金额统一美元（ccusage 给的就是美元）；token 用 K / M / B，和 ccusage 命令行一致
import type { Lang, Translate } from "../i18n";

export function money(value: number): string {
  // ccusage 在没数据时会给 -0，显示成 $0.00
  const v = Object.is(value, -0) ? 0 : value;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function tokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + "K";
  return String(Math.round(value));
}

export function percent(ratio: number, digits = 1): string {
  return (ratio * 100).toFixed(digits) + "%";
}

/** ccusage 的日期是 YYYY-MM-DD，按本地时间解析 */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 本地日期转成 ccusage 参数要的 YYYYMMDD */
export function toArg(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${m}${d}`;
}

/** 图表横轴用的短日期：中文 10-14，英文 Oct 14 */
export function shortDay(day: string, lang: Lang): string {
  const date = parseDay(day);
  if (lang === "zh") return `${date.getMonth() + 1}-${date.getDate()}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 带星期的日期：中文 10月14日 周三，英文 Wed, Oct 14 */
export function longDay(day: string, lang: Lang): string {
  const date = parseDay(day);
  return lang === "zh"
    ? date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

/** 月份：中文 2026年10月，英文 Oct 2026 */
export function monthLabel(month: string, lang: Lang): string {
  const date = parseDay(`${month}-01`);
  return date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short" });
}

/** 时刻：14:05 */
export function clock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 限额重置的时刻：一天以内写 14:05，再远加上星期（周六 14:05 / Sat 14:05） */
export function resetClock(iso: string, now: number, lang: Lang): string {
  const date = new Date(iso);
  if (date.getTime() - now < 86_400_000) return clock(iso);
  const day = date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { weekday: "short" });
  return `${day} ${clock(iso)}`;
}

/** 数据多久前更新的：一分钟内按秒，一小时内按分钟，再久就写时刻 */
export function updatedAgo(t: Translate, updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 60) return t("status.updatedSec", { n: seconds });
  if (seconds < 3600) return t("status.updatedMin", { n: Math.floor(seconds / 60) });
  return t("status.updatedAt", { time: clock(new Date(updatedAt).toISOString()) });
}

/** 分钟数写成 2h 15m；一天以上写成 3d 4h（7 天限额的重置、很长的空档） */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}
