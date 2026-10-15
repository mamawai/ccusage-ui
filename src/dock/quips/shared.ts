// 小 Dock 趣味句共用的类型和数字格式
import type { Lang } from "../../i18n";

/** 一句趣味话：正文 + 一句冷知识 */
export interface Quip {
  /** 去重用：同一句别连着出现 */
  id: string;
  emoji: string;
  text: string;
  fact?: string;
  /** 彩蛋：碰上特殊金额、特殊日子才有，界面上用强调色 */
  rare?: boolean;
  /** 是"还差多少 / 攒到百分之几"这种还买不起的说法；里程碑气泡不挑这种 */
  short?: boolean;
}

/** 一样有固定价格的东西。今天的花费除以价格，就是"够买几个" */
export interface Item {
  id: string;
  emoji: string;
  /** 一个多少美元 */
  price: number;
  /** 中文叫法，以"一"+量词开头（一份 Costco 热狗套餐）；数量多时把"一"换成数字 */
  zh: string;
  /** 英文：一个、很多个（a Costco hot dog combo / Costco hot dog combos） */
  en: [one: string, many: string];
  /** 买得起时用的动词，默认"买 / buy"：吃、喝、住… */
  verb?: [zh: string, en: string];
  /** 历史价格：哪一年，句子开头说"放在 1962 年"；一段年份写成 "1886-1959" */
  year?: string;
  /** 独一份的东西（整个阿拉斯加、某份合同）：只说"够买下"，不说"够买 3 个"。zh 不以"一"开头 */
  unique?: boolean;
  /** 在哪儿的价格，句子开头说"在瑞士"（巨无霸指数） */
  where?: [zh: string, en: string];
  fact?: [zh: string, en: string];
}

/** 换算方式特别的东西（按公斤、按晚算的），自己写句子 */
export interface Rate {
  id: string;
  emoji: string;
  make: (cost: number, lang: Lang) => { text: string; fact?: string };
}

/** 个数：取整，千分位 */
export function count(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

/** 小数：最多保留一位（4.5 回） */
export function decimal(n: number): string {
  return n >= 100 ? count(n) : String(Math.round(n * 10) / 10);
}

/** 比例写成百分数；很小的比例保留两位有效数字（0.0000019%），不写成科学计数法 */
export function share(ratio: number): string {
  const p = ratio * 100;
  if (p >= 1) return `${Math.floor(p)}%`;
  const digits = Math.min(12, Math.max(1, 1 - Math.floor(Math.log10(p))));
  // 浮点误差会多出一位 0（0.00000100），去掉末尾的 0
  return `${p.toFixed(digits).replace(/0+$/, "")}%`;
}

/** 秒数写成 7 分 39 秒 / 7 min 39 s；超过一天写天和小时 */
export function span(seconds: number, lang: Lang): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: [number, string, string][] = d
    ? [
        [d, "天", "d"],
        [h, "小时", "h"],
      ]
    : h
      ? [
          [h, "小时", "h"],
          [m, "分", "min"],
        ]
      : [
          [m, "分", "min"],
          [s % 60, "秒", "s"],
        ];
  return parts
    .filter(([n], i) => n > 0 || i === parts.length - 1)
    .map(([n, zh, en]) => (lang === "zh" ? `${n} ${zh}` : `${n} ${en}`))
    .join(" ");
}

/** 克数写成 26 克 / 1.2 公斤 */
export function grams(g: number, lang: Lang): string {
  if (g >= 1000) return lang === "zh" ? `${decimal(g / 1000)} 公斤` : `${decimal(g / 1000)} kg`;
  return lang === "zh" ? `${decimal(g)} 克` : `${decimal(g)} g`;
}
