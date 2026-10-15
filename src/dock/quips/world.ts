// 有公开数据的价格：经济学人的巨无霸指数、美国劳工统计局的城市平均零售价。
// 都是某个月的快照，句子里写明是哪个月的价
import type { Item, Rate } from "./shared";
import { count, decimal } from "./shared";

// ---------- 巨无霸指数 ----------
// The Economist big-mac-data（MIT 许可）2026-07-01 那一期，github.com/TheEconomist/big-mac-data
// 每行：英文名、中文名、当地价、货币、合多少美元（当地价 ÷ 当期汇率）

const BIG_MACS: [en: string, zh: string, local: number, currency: string, usd: number][] = [
  ["Argentina", "阿根廷", 8700, "ARS", 5.91],
  ["Australia", "澳大利亚", 8.5, "AUD", 5.95],
  ["Azerbaijan", "阿塞拜疆", 7.25, "AZN", 4.26],
  ["Bahrain", "巴林", 1.8, "BHD", 4.77],
  ["Brazil", "巴西", 23.9, "BRL", 4.71],
  ["Britain", "英国", 5.49, "GBP", 7.4],
  ["Canada", "加拿大", 8.17, "CAD", 5.81],
  ["Chile", "智利", 4990, "CLP", 5.41],
  ["China", "中国内地", 26.5, "CNY", 3.91],
  ["Colombia", "哥伦比亚", 25900, "COP", 8.0],
  ["Costa Rica", "哥斯达黎加", 3150, "CRC", 7.0],
  ["Czech Republic", "捷克", 115, "CZK", 5.43],
  ["Denmark", "丹麦", 46, "DKK", 7.04],
  ["Egypt", "埃及", 145, "EGP", 2.87],
  ["the euro area", "欧元区", 6.19, "EUR", 7.08],
  ["Guatemala", "危地马拉", 34, "GTQ", 4.46],
  ["Honduras", "洪都拉斯", 139, "HNL", 5.19],
  ["Hong Kong", "中国香港", 25.5, "HKD", 3.25],
  ["Hungary", "匈牙利", 1660, "HUF", 5.3],
  ["India", "印度", 236.25, "INR", 2.45],
  ["Indonesia", "印度尼西亚", 43000, "IDR", 2.38],
  ["Israel", "以色列", 23, "ILS", 7.67],
  ["Japan", "日本", 500, "JPY", 3.08],
  ["Jordan", "约旦", 2.5, "JOD", 3.53],
  ["Kuwait", "科威特", 1.4, "KWD", 4.52],
  ["Lebanon", "黎巴嫩", 480000, "LBP", 5.36],
  ["Malaysia", "马来西亚", 14.55, "MYR", 3.57],
  ["Mexico", "墨西哥", 109, "MXN", 6.27],
  ["Moldova", "摩尔多瓦", 80, "MDL", 4.56],
  ["New Zealand", "新西兰", 8.8, "NZD", 5.14],
  ["Nicaragua", "尼加拉瓜", 187, "NIO", 5.11],
  ["Norway", "挪威", 78, "NOK", 8.05],
  ["Oman", "阿曼", 1.53, "OMR", 3.97],
  ["Pakistan", "巴基斯坦", 1080, "PKR", 3.89],
  ["Peru", "秘鲁", 16.9, "PEN", 4.99],
  ["the Philippines", "菲律宾", 169, "PHP", 2.74],
  ["Poland", "波兰", 23.5, "PLN", 6.22],
  ["Qatar", "卡塔尔", 18, "QAR", 4.94],
  ["Romania", "罗马尼亚", 18.35, "RON", 4.01],
  ["Saudi Arabia", "沙特阿拉伯", 19, "SAR", 5.06],
  ["Singapore", "新加坡", 7.45, "SGD", 5.77],
  ["South Africa", "南非", 56.9, "ZAR", 3.49],
  ["South Korea", "韩国", 5700, "KRW", 3.84],
  ["Sweden", "瑞典", 69, "SEK", 7.16],
  ["Switzerland", "瑞士", 7.3, "CHF", 9.04],
  ["Taiwan", "中国台湾", 78, "TWD", 2.42],
  ["Thailand", "泰国", 135, "THB", 4.02],
  ["Turkey", "土耳其", 325, "TRY", 6.91],
  ["Ukraine", "乌克兰", 149, "UAH", 3.34],
  ["the UAE", "阿联酋", 19, "AED", 5.17],
  ["the US", "美国", 6.22, "USD", 6.22],
  ["Uruguay", "乌拉圭", 359, "UYU", 8.94],
  ["Venezuela", "委内瑞拉", 3267, "VES", 4.51],
  ["Vietnam", "越南", 76000, "VND", 2.89],
];

const PRICIEST = Math.max(...BIG_MACS.map((b) => b[4]));
const CHEAPEST = Math.min(...BIG_MACS.map((b) => b[4]));

export const BIG_MAC_ITEMS: Item[] = BIG_MACS.map(([en, zh, local, currency, usd]) => {
  const at = `${local.toLocaleString("en-US")} ${currency}`;
  // 最贵、最便宜的两处换成排名，别的写当地价
  const fact: [string, string] =
    usd === PRICIEST
      ? [`全球最贵的巨无霸：$${usd}（2026 年 7 月巨无霸指数）`, `The priciest Big Mac on Earth: $${usd} (Big Mac index, Jul 2026)`]
      : usd === CHEAPEST
        ? [`全球最便宜的巨无霸：$${usd}（2026 年 7 月巨无霸指数）`, `The cheapest Big Mac on Earth: $${usd} (Big Mac index, Jul 2026)`]
        : [`当地卖 ${at}，约合 $${usd}（2026 年 7 月巨无霸指数）`, `${at} there, about $${usd} (Big Mac index, Jul 2026)`];
  return {
    id: `bigmac-${currency}`,
    emoji: "🍔",
    price: usd,
    zh: "一个巨无霸",
    en: ["a Big Mac", "Big Macs"],
    where: [zh, en],
    fact,
  };
});

// ---------- 美国城市平均零售价 ----------
// 美国劳工统计局 2026 年 9 月的平均价（bls.gov 的 Average Price Data，和 FRED 上的 APU 系列逐项对过）

/** 一根中等香蕉 118 克（USDA 的标准份量），合 0.26 磅 */
const BANANA_LB = 118 / 453.592;

export const US_ITEMS: Item[] = [
  {
    id: "us-eggs",
    emoji: "🥚",
    price: 2.272 / 12,
    zh: "一个鸡蛋",
    en: ["an egg", "eggs"],
    fact: ["美国 9 月均价 $2.27 一打；2025 年 3 月禽流感时涨到过 $6.23", "US avg $2.27/dozen; bird flu hit $6.23 in Mar 2025"],
  },
  {
    id: "us-banana",
    emoji: "🍌",
    price: 0.656 * BANANA_LB,
    zh: "一根香蕉",
    en: ["a banana", "bananas"],
    fact: ["美国 9 月均价 $0.66 一磅，一根中等香蕉按 118 克算", "US avg $0.66/lb in Sep; a medium banana is 118 g"],
  },
  {
    id: "us-gas",
    emoji: "⛽",
    price: 4.482,
    zh: "一加仑汽油",
    en: ["a gallon of gas", "gallons of gas"],
    verb: ["加", "pump"],
    fact: ["美国 9 月普通汽油均价 $4.48 一加仑，一加仑约 3.79 升", "US avg regular unleaded: $4.48/gal in Sep"],
  },
  {
    id: "us-milk",
    emoji: "🥛",
    price: 4.106,
    zh: "一加仑全脂牛奶",
    en: ["a gallon of whole milk", "gallons of whole milk"],
    fact: ["美国 9 月均价 $4.11 一加仑", "US avg $4.11/gal in Sep"],
  },
  {
    id: "us-bread",
    emoji: "🍞",
    price: 1.83,
    zh: "一磅白面包",
    en: ["a pound of white bread", "pounds of white bread"],
    fact: ["美国 9 月均价 $1.83 一磅", "US avg $1.83/lb in Sep"],
  },
  {
    id: "us-patty",
    emoji: "🥩",
    price: 6.483 / 4,
    zh: "一块四分之一磅牛肉饼",
    en: ["a quarter-pound beef patty", "quarter-pound beef patties"],
    verb: ["做", "make"],
    fact: ["美国 9 月牛肩肉末均价 $6.48 一磅，四块正好一磅", "Ground chuck averaged $6.48/lb in Sep; four patties to the pound"],
  },
  {
    id: "us-chicken",
    emoji: "🐔",
    price: 2.064,
    zh: "一磅整鸡",
    en: ["a pound of whole chicken", "pounds of whole chicken"],
    fact: ["美国 9 月均价 $2.06 一磅", "US avg $2.06/lb in Sep"],
  },
  {
    id: "us-orange",
    emoji: "🍊",
    price: 1.723,
    zh: "一磅脐橙",
    en: ["a pound of navel oranges", "pounds of navel oranges"],
    fact: ["美国 9 月均价 $1.72 一磅", "US avg $1.72/lb in Sep"],
  },
  {
    id: "us-tomato",
    emoji: "🍅",
    price: 1.992,
    zh: "一磅番茄",
    en: ["a pound of tomatoes", "pounds of tomatoes"],
    fact: ["美国 9 月均价 $1.99 一磅", "US avg $1.99/lb in Sep"],
  },
  {
    id: "us-kwh",
    emoji: "🔌",
    price: 0.196,
    zh: "一度电",
    en: ["a kWh of electricity", "kWh of electricity"],
    fact: ["美国 9 月电价均价 19.6 美分一度", "US avg 19.6¢/kWh in Sep"],
  },
];

/** 美国 9 月均价电费，每度多少美元 */
const KWH = 0.196;
/** 1 升水从 20°C 烧到 100°C 至少要的电：4186 J/(kg·K) × 80 K = 334,880 J，合 0.093 度 */
const BOIL_KWH = (4186 * 80) / 3.6e6;
/** RTX 5090 的整卡功耗（NVIDIA 官方 575 W） */
const RTX_5090_KW = 0.575;

export const US_RATES: Rate[] = [
  {
    id: "us-boil",
    emoji: "🫖",
    make: (cost, lang) => {
      const liters = cost / (BOIL_KWH * KWH);
      return lang === "zh"
        ? { text: `够把 ${count(liters)} 升水从 20°C 烧开`, fact: "按美国 9 月均价电费，不算热损耗的理论值" }
        : { text: `Enough to boil ${count(liters)} liters of water from 20°C`, fact: "Theoretical, at the US Sep avg power price" };
    },
  },
  {
    id: "us-rtx",
    emoji: "🎮",
    make: (cost, lang) => {
      const hours = cost / (RTX_5090_KW * KWH);
      const days = hours / 24;
      return lang === "zh"
        ? {
            text: `够一张 RTX 5090 满载跑 ${count(hours)} 小时${days >= 2 ? `（${decimal(days)} 天）` : ""}`,
            fact: "整卡功耗 575 W，按美国 9 月均价电费",
          }
        : {
            text: `Runs an RTX 5090 flat out for ${count(hours)} hours${days >= 2 ? ` (${decimal(days)} days)` : ""}`,
            fact: "575 W card power at the US Sep avg power price",
          };
    },
  },
];
