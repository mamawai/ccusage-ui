// ccusage --json 输出的类型，照着 ccusage 20.0.31 的源码和实际输出写的。
// ccusage 升级后字段可能变，用的时候缺了就当没有，别假设一定在。

/** 四类 token，ccusage 的日 / 周 / 月 / 会话报表都有 */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

/** 某个模型的用量 */
export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  /** 只有这个模型找不到价格时才出现，值为 true */
  missingPricing?: true;
}

/** 日 / 周 / 月 / 会话报表里每一行共有的部分 */
export interface UsageRow extends TokenCounts {
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
  /** 少数 Agent 才有（如 Amp、Codebuff、OpenCode） */
  credits?: number;
}

/** 报表底部的合计 */
export interface Totals extends TokenCounts {
  totalCost: number;
  credits?: number;
  /** 有用量但找不到价格的模型，这些模型没算进费用 */
  unpricedModels?: string[];
}

// ---------- Claude Code（ccusage claude ...） ----------

export interface ClaudeDailyRow extends UsageRow {
  /** YYYY-MM-DD */
  date: string;
  /** 只有按项目分组时才有 */
  project?: string;
}

/** ccusage claude daily --json */
export interface ClaudeDailyReport {
  daily: ClaudeDailyRow[];
  totals: Totals;
}

/** ccusage claude daily --instances --json；一个项目都没有时 ccusage 会退回 ClaudeDailyReport 的形状 */
export interface ClaudeProjectsReport {
  /** 键是项目名，即 ~/.claude/projects 下的目录名 */
  projects: Record<string, ClaudeDailyRow[]>;
  totals: Totals;
}

/** ccusage claude weekly --json */
export interface ClaudeWeeklyReport {
  /** week 是这一周的起始日 YYYY-MM-DD */
  weekly: (UsageRow & { week: string })[];
  totals: Totals;
}

/** ccusage claude monthly --json */
export interface ClaudeMonthlyReport {
  /** month 形如 YYYY-MM */
  monthly: (UsageRow & { month: string })[];
  totals: Totals;
}

export interface ClaudeSessionRow extends UsageRow {
  sessionId: string;
  /** 项目目录名，即 ~/.claude/projects 下的目录名 */
  projectPath: string;
  /** ISO 时间 */
  firstActivity: string;
  lastActivity: string;
}

/** ccusage claude session --json，按 totalCost 从高到低 */
export interface ClaudeSessionReport {
  sessions: ClaudeSessionRow[];
  totals: Totals;
}

/** ccusage claude session --id --json 里的一次调用 */
export interface ClaudeSessionEntry {
  /** ISO 时间 */
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string;
  /** 日志里记录的原始费用，Claude Code 现在不写这个字段，基本都是 0，别展示 */
  costUSD: number;
}

/** ccusage claude session --id --json；会话不存在时 ccusage 输出 null */
export interface ClaudeSessionDetail {
  sessionId: string;
  totalCost: number;
  totalTokens: number;
  entries: ClaudeSessionEntry[];
}

export interface BurnRate {
  tokensPerMinute: number;
  /** 只算输入 + 输出、不含缓存的速率，ccusage 用它判断快慢 */
  tokensPerMinuteForIndicator: number;
  costPerHour: number;
}

export interface Projection {
  totalTokens: number;
  totalCost: number;
  remainingMinutes: number;
}

export interface TokenLimitStatus {
  limit: number;
  projectedUsage: number;
  percentUsed: number;
  status: "ok" | "warning" | "exceeds";
}

/** 5 小时计费块 */
export interface Block {
  id: string;
  /** ISO 时间；块从整点开始，持续 5 小时 */
  startTime: string;
  endTime: string;
  /** 块里最后一次调用的时间，空档块为 null */
  actualEndTime: string | null;
  isActive: boolean;
  /** 两段使用之间超过 5 小时的空档 */
  isGap: boolean;
  /** 调用次数 */
  entries: number;
  /** 注意这里的字段名和别的报表不一样 */
  tokenCounts: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  totalTokens: number;
  costUSD: number;
  models: string[];
  /** 只有进行中的块有 */
  burnRate: BurnRate | null;
  projection: Projection | null;
  /** 进行中的块，且传了 tokenLimit、上限算得出来时才有 */
  tokenLimitStatus?: TokenLimitStatus;
  /** 这个块里触发过用量上限时才有：上限重置的时间 */
  usageLimitResetTime?: string;
}

/** ccusage claude blocks --json；没有 totals */
export interface ClaudeBlocksReport {
  blocks: Block[];
}

// ---------- 全部 Agent（ccusage daily --by-agent --sections ...） ----------

/** 某个 Agent 在这一行里的用量 */
export interface AgentBreakdown extends UsageRow {
  /** Agent 的 id，如 claude、codex、gemini */
  agent: string;
}

export interface AllAgentsRow extends UsageRow {
  /** 日：YYYY-MM-DD；周：起始日；月：YYYY-MM；会话：会话 ID */
  period: string;
  /** 日 / 周 / 月行是 "all"；会话行是具体的 Agent id */
  agent: string;
  /** 只在日 / 周 / 月行里有，按 Agent 拆开的用量 */
  agents?: AgentBreakdown[];
  metadata?: {
    /** 日 / 周 / 月行：这一行里有哪些 Agent */
    agents?: string[];
    /** 会话行：最后活动时间 */
    lastActivity?: string;
    /** 只有 pi-agent 这类会话有 */
    projectPath?: string;
    credits?: number;
    /** Codex 会话：推理 token，已经算在 outputTokens 里 */
    reasoningOutputTokens?: number;
  };
}

/** 按请求的 sections 出现对应字段；totals 是第一个 section 的合计 */
export interface AllAgentsReport {
  daily?: AllAgentsRow[];
  weekly?: AllAgentsRow[];
  monthly?: AllAgentsRow[];
  session?: AllAgentsRow[];
  totals: Totals;
}

// ---------- 找 ccusage ----------

/** ccusage 是怎么装的 */
export type InstallMethod = "npm" | "pnpm" | "bun" | "yarn" | "bundled" | "unknown";

export interface Install {
  method: InstallMethod;
  /** 实际运行的文件 */
  exe: string;
  version: string | null;
  /** 是不是终端里敲 ccusage 会跑到的那一份 */
  onPath: boolean;
}

export interface Located {
  /** 在用的那一份；没有就说明本机没装 ccusage */
  active: Install | null;
  all: Install[];
}

/** 能装全局包的包管理器 */
export type ManagerMethod = "npm" | "pnpm" | "bun" | "yarn";

export interface PackageManager {
  method: ManagerMethod;
  version: string | null;
  /** 能不能全局安装：pnpm 没跑过 pnpm setup、yarn 2 以上都不行 */
  ready: boolean;
}
