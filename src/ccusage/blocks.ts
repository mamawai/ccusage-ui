// 计费块相关的小工具：概览页、计费块页、小 Dock 都用
import type { Block } from "./types";

export type BurnLevel = "ok" | "warn" | "high";

/** 快慢档位沿用 ccusage statusline 的阈值（只算输入 + 输出、不含缓存的每分钟 token） */
export function burnLevel(tokensPerMinuteForIndicator: number): BurnLevel {
  if (tokensPerMinuteForIndicator < 2000) return "ok";
  if (tokensPerMinuteForIndicator < 5000) return "warn";
  return "high";
}

/** 三档的颜色，实际色值在 global.css（浅色、深色各一套） */
export const BURN_COLOR: Record<BurnLevel, string> = { ok: "var(--burn-ok)", warn: "var(--burn-warn)", high: "var(--burn-high)" };

/** 还在进行中的块：ccusage 说是进行中，而且还没到结束时间（账本没刷新时，到点也算结束） */
export function liveBlock(blocks: Block[], now: number): Block | undefined {
  return blocks.find((b) => b.isActive && !b.isGap && Date.parse(b.endTime) > now);
}

/** 块从开始到最后一次调用用了多少分钟（空档块没有） */
export function usedMinutes(block: Block): number {
  if (!block.actualEndTime) return 0;
  return (Date.parse(block.actualEndTime) - Date.parse(block.startTime)) / 60_000;
}
