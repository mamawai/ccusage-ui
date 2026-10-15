// 小 Dock 的趣味句：把今天花的钱换算成别的东西，顺带一句冷知识。
// 每次从几类里随机挑：现在的物价、几十年不涨价的东西、历史价格、科技产品、太空之类的怪东西、巨无霸指数、
// 用户自己的数据（比昨天、本月排名、连续天数…），碰上特殊金额或日子还有彩蛋。
// 先按类别抽再在类别里抽，免得条目多的类别（巨无霸 54 个国家）刷屏；最近出现过的句子先不出
import type { Lang } from "../../i18n";
import type { Block } from "../../ccusage/types";
import { parseDay, money, tokens } from "../../ui/format";
import { CATALOG } from "./catalog";
import { count, decimal, share, span, type Item, type Quip, type Rate } from "./shared";
import { BIG_MAC_ITEMS, US_ITEMS, US_RATES } from "./world";

export type { Quip } from "./shared";

/** 换算用到的数据，都是统计范围内的 */
export interface QuipContext {
  lang: Lang;
  now: number;
  /** 今天花了多少 */
  cost: number;
  /** 每天花了多少（YYYY-MM-DD → 美元），全部历史 */
  days: Record<string, number>;
  /** 今天的输出 token */
  todayOutput: number;
  /** Claude Code 最近 7 天按小时的块；别的范围没有 */
  hours?: Block[];
  /** 进行中的 5h 窗口每小时花多少；没有就是 undefined */
  burnPerHour?: number;
}

/** 今天的花费跨过这些数时，小 Dock 冒一句 */
export const MILESTONES = [5, 10, 20, 50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000];

/** 从 prev 涨到 cur 跨过的最大一个里程碑；没跨过就是 null */
export function crossedMilestone(prev: number, cur: number): number | null {
  const hit = MILESTONES.filter((m) => prev < m && cur >= m);
  return hit.length ? hit[hit.length - 1] : null;
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** 整数金额：$100 */
function dollars(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}

/** 日期写成 9月14日 / Sep 14 */
function dayName(day: string, lang: Lang): string {
  const d = parseDay(day);
  return lang === "zh" ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------- 有固定价格的东西 ----------

/** 拼中文句子：英文、数字和汉字挨着时中间加个空格（Apple Watch Ultra 4 还差、离 1976 年） */
function zhJoin(...parts: string[]): string {
  return parts.reduce((a, b) =>
    (/[A-Za-z0-9)%]$/.test(a) && /^[一-鿿]/.test(b)) || (/[一-鿿]$/.test(a) && /^[A-Za-z0-9$(]/.test(b))
      ? `${a} ${b}`
      : a + b,
  );
}

/** 中文数量：一个时原样（一份热狗），多个时把开头的"一"换成数字（123 份热狗） */
function zhAmount(item: Item, n: number): string {
  return n < 2 ? item.zh : item.zh.replace(/^一/, `${count(n)} `);
}

/** 年份：1962 年 / 1886～1959 年间；英文 1962 / 1886–1959 */
function yearZh(year: string): string {
  const [a, b] = year.split("-");
  return b ? `${a}～${b} 年间` : `${a} 年`;
}

function yearEn(year: string): string {
  return year.replace("-", "–");
}

function itemQuip(item: Item, cost: number, lang: Lang): Quip {
  const n = cost / item.price;
  const [one, many] = item.en;
  const [verbZh, verbEn] = item.verb ?? ["买", "buy"];
  let text: string;
  if (n >= 1) {
    if (lang === "zh") {
      // 独一份的东西只说"够买下"
      const what = zhJoin(item.unique ? "够买下" : `够${verbZh}`, item.unique ? item.zh : zhAmount(item, n));
      text = item.year
        ? zhJoin(`放在 ${yearZh(item.year)}，`, what)
        : item.where
          ? zhJoin(`在${item.where[0]}`, what)
          : pick([what, `今天花的钱${what.replace(/^够/, "能")}`]);
    } else {
      // 英文比中文长，句式尽量短，免得超过两行
      const amount = item.unique || n < 2 ? one : `${count(n)} ${many}`;
      text = item.year
        ? `At ${yearEn(item.year)} prices: ${amount}`
        : `Enough to ${verbEn} ${amount}${item.where ? ` in ${item.where[1]}` : ""}`;
    }
  } else {
    // 还买不起：差多少，或者攒到了百分之几。差得多时不写到分
    const left = item.price - cost;
    const gap = left >= 1000 ? dollars(Math.round(left)) : money(left);
    // 1976 年的一台 Apple-1；独一份的东西年份放后面，免得"的"连着出现（罗纳德·韦恩的 10% 苹果股份（1976 年））
    const zhName = item.unique
      ? `${item.zh}${item.year ? `（${yearZh(item.year).replace(/间$/, "")}）` : ""}`
      : zhJoin(item.year ? `${yearZh(item.year).replace(/间$/, "")}的` : "", item.where ? `${item.where[0]}的` : "", item.zh);
    const enName = `${one}${item.year ? ` (${yearEn(item.year)})` : ""}${item.where ? ` in ${item.where[1]}` : ""}`;
    text =
      Math.random() < 0.5
        ? lang === "zh"
          ? zhJoin("离", zhName, `还差 ${gap}`)
          : `${gap} short of ${enName}`
        : lang === "zh"
          ? zhJoin(zhName, `已经攒到 ${share(n)}`)
          : `${share(n)} of ${enName}`;
  }
  return { id: item.id, emoji: item.emoji, text, fact: item.fact?.[lang === "zh" ? 0 : 1], short: n < 1 };
}

function rateQuip(rate: Rate, cost: number, lang: Lang): Quip {
  return { id: rate.id, emoji: rate.emoji, ...rate.make(cost, lang) };
}

// ---------- 用户自己的数据 ----------

/** 《哈利·波特与魔法石》约 76,944 个英文词；1 个词约 1.33 token（OpenAI 的经验值：1 token ≈ 0.75 词） */
const BOOK_TOKENS = 76_944 / 0.75;
/** 人打字按每分钟 40 个英文词 */
const TYPING_WPM = 40;

function mine(ctx: QuipContext): Quip[] {
  const { lang, cost, now } = ctx;
  const zh = lang === "zh";
  const out: Quip[] = [];
  const today = isoDay(new Date(now));
  const past = Object.entries(ctx.days).filter(([d, c]) => d < today && c > 0);

  // 比昨天这个点：用按小时的块，两边都只算到"现在"这个钟点
  if (ctx.hours) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const t0 = start.getTime();
    let todaySoFar = 0;
    let yesterdaySoFar = 0;
    for (const b of ctx.hours) {
      if (b.isGap) continue;
      const t = Date.parse(b.startTime);
      if (t >= t0) todaySoFar += b.costUSD;
      else if (t >= t0 - 86_400_000 && t < now - 86_400_000) yesterdaySoFar += b.costUSD;
    }
    if (yesterdaySoFar >= 1) {
      const diff = todaySoFar - yesterdaySoFar;
      const ratio = Math.abs(diff) / yesterdaySoFar;
      const pct = `${Math.round(ratio * 100)}%`;
      out.push({
        id: "mine-yesterday",
        emoji: diff >= 0 ? "📈" : "📉",
        text: zh
          ? diff >= 0
            ? `比昨天这个点多花了 ${money(diff)}（+${pct}）`
            : `比昨天这个点少花了 ${money(-diff)}（-${pct}）`
          : diff >= 0
            ? `${money(diff)} more than this time yesterday (+${pct})`
            : `${money(-diff)} less than this time yesterday (-${pct})`,
        fact: zh ? `昨天到这个点是 ${money(yesterdaySoFar)}` : `Yesterday by now: ${money(yesterdaySoFar)}`,
      });
    }
  }

  // 历史纪录
  if (past.length >= 7) {
    const [recordDay, record] = past.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (cost > record) {
      out.push({
        id: "mine-record",
        emoji: "🏆",
        rare: true,
        text: zh ? "破纪录了！有记录以来最贵的一天" : "New record! Your priciest day ever",
        fact: zh
          ? `之前的纪录是 ${dayName(recordDay, lang)}的 ${money(record)}`
          : `Previous record: ${money(record)} on ${dayName(recordDay, lang)}`,
      });
    } else {
      out.push({
        id: "mine-record",
        emoji: "🏔️",
        text: zh ? `离历史最高还差 ${money(record - cost)}` : `${money(record - cost)} short of your all-time high`,
        fact: zh ? `纪录是 ${dayName(recordDay, lang)}：${money(record)}` : `Record: ${money(record)} on ${dayName(recordDay, lang)}`,
      });
    }
  }

  // 本月排名、今天占本月多少
  const monthStart = `${today.slice(0, 8)}01`;
  const month = past.filter(([d]) => d >= monthStart);
  if (month.length >= 2) {
    const [topDay, top] = month.reduce((a, b) => (b[1] > a[1] ? b : a));
    const rank = month.filter(([, c]) => c > cost).length + 1;
    out.push({
      id: "mine-month-rank",
      emoji: rank === 1 ? "👑" : "🥈",
      text: zh
        ? rank === 1
          ? "今天已经是本月最贵的一天了"
          : `今天排本月第 ${rank} 贵`
        : rank === 1
          ? "Today is already this month's priciest day"
          : `Today ranks #${rank} this month`,
      fact:
        rank === 1
          ? zh
            ? `之前最高是 ${dayName(topDay, lang)}的 ${money(top)}`
            : `Previous high: ${money(top)} on ${dayName(topDay, lang)}`
          : zh
            ? `第一是 ${dayName(topDay, lang)}的 ${money(top)}，还差 ${money(top - cost)}`
            : `#1 is ${money(top)} on ${dayName(topDay, lang)}, ${money(top - cost)} to go`,
    });
    const monthCost = month.reduce((s, [, c]) => s + c, cost);
    out.push({
      id: "mine-month-share",
      emoji: "🧾",
      text: zh ? `今天一天花掉了本月的 ${share(cost / monthCost)}` : `Today alone is ${share(cost / monthCost)} of this month`,
      fact: zh ? `本月到现在一共 ${money(monthCost)}` : `Month to date: ${money(monthCost)}`,
    });
  }

  // 连续几天破某个数：挑能凑满 3 天的最大一档
  for (const line of [1000, 500, 200, 100, 50, 20]) {
    let streak = 0;
    for (let d = new Date(now - 86_400_000); (ctx.days[isoDay(d)] ?? 0) >= line; d = new Date(d.getTime() - 86_400_000)) {
      streak++;
    }
    const withToday = cost >= line ? streak + 1 : streak;
    if (withToday < 3) continue;
    out.push({
      id: "mine-streak",
      emoji: "🔥",
      text: zh ? `已经连续 ${withToday} 天破 ${dollars(line)} 了` : `${withToday} days in a row over ${dollars(line)}`,
      fact:
        cost >= line
          ? zh
            ? "今天也已经续上了"
            : "Today already counts"
          : zh
            ? `今天再花 ${money(line - cost)} 就是第 ${streak + 1} 天`
            : `${money(line - cost)} more today makes it ${streak + 1}`,
    });
    break;
  }

  // 按现在的速度，每多久花掉一样小东西
  const burn = ctx.burnPerHour;
  if (burn && burn > 0) {
    const cheap = [...CATALOG.icons, ...US_ITEMS].filter((i) => i.price >= 1 && i.price <= 30 && !i.year);
    if (cheap.length) {
      const item = pick(cheap);
      const every = span((item.price / burn) * 3600, lang);
      const rate = dollars(Math.round(burn));
      out.push({
        id: "mine-burn",
        emoji: "⏱️",
        text: zh ? zhJoin(`按每小时 ${rate}，每 ${every}`, "花掉", item.zh) : `At ${rate}/h: ${item.en[0]} every ${every}`,
        fact: item.fact?.[zh ? 0 : 1],
      });
    }
  }

  // Claude 今天写了多少字
  const outTokens = ctx.todayOutput;
  if (outTokens >= 10_000) {
    const books = outTokens / BOOK_TOKENS;
    out.push({
      id: "mine-books",
      emoji: "📚",
      text: zh
        ? books >= 1
          ? `今天输出了 ${tokens(outTokens)} token，约 ${decimal(books)} 本《哈利·波特与魔法石》`
          : `今天输出了 ${tokens(outTokens)} token，约《哈利·波特与魔法石》的 ${share(books)}`
        : `${tokens(outTokens)} tokens out today ≈ ${decimal(books)}× Harry Potter #1`,
      fact: zh ? "那本书约 7.7 万个英文词，1 个词约 1.33 token" : "The book is ~77K words; 1 word ≈ 1.33 tokens",
    });
    const minutes = (outTokens * 0.75) / TYPING_WPM;
    out.push({
      id: "mine-typing",
      emoji: "⌨️",
      text: zh ? `这些字换你自己打，要不吃不睡打 ${span(minutes * 60, lang)}` : `Typing that yourself: ${span(minutes * 60, lang)} nonstop`,
      fact: zh ? `按每分钟 ${TYPING_WPM} 个英文词估` : `At ${TYPING_WPM} words per minute`,
    });
  }

  // 几点了、星期几
  const date = new Date(now);
  const hour = date.getHours();
  const weekday = date.getDay();
  if (hour < 5) {
    out.push({
      id: "mine-late",
      emoji: "🌙",
      text: zh ? `凌晨 ${hour} 点还在烧 token，Claude 都想下班了` : `${hour} a.m. and still burning tokens`,
      fact: zh ? `今天到现在 ${money(cost)}` : `Today so far: ${money(cost)}`,
    });
  } else if (weekday === 0 || weekday === 6) {
    out.push({
      id: "mine-weekend",
      emoji: "🏖️",
      text: zh ? `周末还在干活，今天已经 ${money(cost)} 了` : `Working the weekend: ${money(cost)} so far`,
    });
  }
  return out;
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- 彩蛋：特殊金额、特殊日子 ----------

/** 整数部分碰上这些数 */
const MAGIC: Record<number, [emoji: string, zh: string, en: string]> = {
  404: ["🫥", "$404：预算 Not Found", "$404: budget not found"],
  520: ["💘", "$520：今天是爱 Claude 的一天", "$520: in Chinese slang, 520 sounds like “I love you”"],
  666: ["🤘", "$666：今天的操作很 6", "$666: devilishly productive"],
  888: ["🧧", "$888：发发发", "$888: triple lucky eights"],
  996: ["🥲", "$996：今天别太卷了", "$996: maybe log off soon"],
  1024: ["💾", "$1024：程序员最爱的数，2 的 10 次方", "$1024: 2¹⁰, a programmer's favorite number"],
};

function rare(ctx: QuipContext): Quip[] {
  const { lang, cost, now } = ctx;
  const zh = lang === "zh";
  const out: Quip[] = [];
  const shown = money(cost).slice(1);

  // 每一位都一样：$66.66、$888.88
  const digits = shown.replace(/[,.]/g, "");
  if (digits.length >= 4 && /^(\d)\1+$/.test(digits)) {
    out.push({
      id: "rare-same",
      emoji: "🎰",
      rare: true,
      text: zh ? `$${shown}，一排全是 ${digits[0]}！` : `$${shown}: all ${digits[0]}s!`,
      fact: zh ? "这一刻截个图吧" : "Screenshot-worthy",
    });
  }
  // 顺子：$123.45、$234.56
  if (digits.length >= 4 && "0123456789".includes(digits)) {
    out.push({
      id: "rare-straight",
      emoji: "🃏",
      rare: true,
      text: zh ? `$${shown}，顺子！` : `$${shown}: a straight!`,
      fact: zh ? "这一刻截个图吧" : "Screenshot-worthy",
    });
  }
  const magic = MAGIC[Math.floor(cost)];
  if (magic) out.push({ id: "rare-magic", emoji: magic[0], rare: true, text: zh ? magic[1] : magic[2] });

  const date = new Date(now);
  // 一年的第几天（1 月 1 日是第 1 天）
  const dayOfYear = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
  // 国际上的程序员日是一年的第 256 天（9 月 13 日，闰年 9 月 12 日）
  const key = dayOfYear === 256 ? "day256" : `${date.getMonth() + 1}-${date.getDate()}`;
  const days: Record<string, [emoji: string, zh: string, en: string, factZh: string, factEn: string]> = {
    "10-24": ["👩‍💻", "今天 10 月 24 日，程序员节快乐", "Happy Programmers' Day (in China it's Oct 24)", "1024 是 2 的 10 次方", "1024 = 2¹⁰"],
    day256: ["👨‍💻", "今天是程序员日（一年第 256 天）", "Happy Programmers' Day: day 256 of the year", "256 是 2 的 8 次方", "256 = 2⁸"],
    "3-14": ["🥧", "今天是圆周率日 π", "Happy Pi Day", "3.1415926…", "3.14159…"],
    "4-1": ["🃏", "愚人节：今天的账单是假的（并不是）", "April Fools': this bill is fake (it isn't)", "", ""],
    "12-25": ["🎄", "圣诞节还在写代码", "Coding on Christmas", "", ""],
    "1-1": ["🎆", "新年第一天，开门红", "First day of the year, off to a strong start", "", ""],
  };
  const special = days[key];
  if (special) {
    const [emoji, zhText, enText, factZh, factEn] = special;
    out.push({
      id: `rare-day-${key}`,
      emoji,
      rare: true,
      text: zh ? zhText : enText,
      fact: (zh ? factZh : factEn) || (zh ? `今天到现在 ${money(cost)}` : `Today so far: ${money(cost)}`),
    });
  }
  return out;
}

// ---------- 今天还没花钱 ----------

function idle(lang: Lang): Quip[] {
  const zh = lang === "zh";
  return [
    { id: "idle-zero", emoji: "🫙", text: zh ? "今天还一分钱没花" : "Not a cent spent today", fact: zh ? "Claude 在等你开口" : "Claude is waiting" },
    {
      id: "idle-blank",
      emoji: "📄",
      text: zh ? "今天的账单还是一张白纸" : "Today's bill is still a blank page",
      fact: zh ? "第一条回复之后这里就开始换算了" : "Conversions start after the first reply",
    },
    {
      id: "idle-hotdog",
      emoji: "🌭",
      text: zh ? "离一份 Costco 热狗套餐还差 $1.50" : "$1.50 short of a Costco hot dog combo",
      fact: zh ? "这个价从 1985 年就没变过" : "Same price since 1985",
    },
  ];
}

// ---------- 抽一句 ----------

/** 最近出现过的句子，先不再出 */
const recent: string[] = [];
const RECENT_LIMIT = 30;

interface Group {
  weight: number;
  quips: Quip[];
}

/** 随机来一句。celebrate：跨过里程碑时用，只挑"够买几个"这种，不挑"还差多少" */
export function randomQuip(ctx: QuipContext, celebrate = false): Quip {
  const { cost, lang } = ctx;
  if (cost <= 0) return remember(pickFresh(idle(lang)));
  const items = (list: Item[]) => list.map((i) => itemQuip(i, cost, lang)).filter((q) => !(celebrate && q.short));
  const rates = (list: Rate[]) => list.map((r) => rateQuip(r, cost, lang));
  const groups: Group[] = [
    { weight: 2, quips: [...items(US_ITEMS), ...rates(US_RATES)] },
    { weight: 1.5, quips: items(BIG_MAC_ITEMS) },
    { weight: 2, quips: items(CATALOG.icons) },
    { weight: 3, quips: items(CATALOG.history) },
    { weight: 2, quips: items(CATALOG.tech) },
    { weight: 2, quips: [...items(CATALOG.odd), ...rates(CATALOG.oddRates)] },
    { weight: 3, quips: mine(ctx) },
    // 彩蛋碰上了就大概率出
    { weight: 8, quips: rare(ctx) },
  ];

  // 最近出现过的先剔掉；某一类全出过了，这一类这次就不参加（条目少的类别不会反复出同一句）
  let pool = groups.map((g) => ({ ...g, quips: g.quips.filter((q) => !recent.includes(q.id)) })).filter((g) => g.quips.length);
  if (!pool.length) pool = groups.filter((g) => g.quips.length);
  const total = pool.reduce((s, g) => s + g.weight, 0);
  let roll = Math.random() * total;
  const group = pool.find((g) => (roll -= g.weight) < 0) ?? pool[pool.length - 1];
  return remember(pick(group.quips));
}

/** 优先挑最近没出现过的 */
function pickFresh(quips: Quip[]): Quip {
  const fresh = quips.filter((q) => !recent.includes(q.id));
  return pick(fresh.length ? fresh : quips);
}

function remember(q: Quip): Quip {
  recent.push(q.id);
  if (recent.length > RECENT_LIMIT) recent.shift();
  return q;
}
