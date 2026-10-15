// 手挑的东西：每条都查过出处（写在注释里），价格是注明日期时的价。
// icons：出了名不涨价的；history：历史价格（史实，不会过时）；tech：科技产品和订阅；odd：太空之类的怪东西
import type { Item, Rate } from "./shared";
import { grams, span } from "./shared";

const icons: Item[] = [
  // Costco 官方 / 多家报道：1985 年起 $1.50，CEO 2026 年仍表示不涨（fortune.com 2026-07-04）
  {
    id: "costco-hotdog",
    emoji: "🌭",
    price: 1.5,
    zh: "一份 Costco 热狗套餐",
    en: ["a Costco hot dog combo", "Costco hot dog combos"],
    verb: ["吃", "eat"],
    fact: ["这个价从 1985 年就没变过", "Still $1.50, same as in 1985"],
  },
  // AriZona 大罐冰茶 99¢（NBC 2025：1992 年创立起就是这个价；品牌博客：1996 年起直接印在罐上；brandspurng 2026-09 仍是 99¢）
  {
    id: "arizona-tea",
    emoji: "🧃",
    price: 0.99,
    zh: "一罐 AriZona 冰茶",
    en: ["a can of AriZona iced tea", "cans of AriZona iced tea"],
    verb: ["喝", "drink"],
    fact: ["99¢ 直接印在罐身上，三十多年没变", "The 99¢ is printed right on the can, unchanged for 30+ years"],
  },
  // 美国星巴克大杯拿铁没有统一价：各店约 $5.25～$5.95（2026 年多个菜单站），取中间的 $5.45
  {
    id: "starbucks-latte",
    emoji: "☕",
    price: 5.45,
    zh: "一杯星巴克大杯拿铁",
    en: ["a Starbucks grande latte", "Starbucks grande lattes"],
    verb: ["喝", "drink"],
    fact: ["美国各店 $5.25～$5.95 不等，这里按 $5.45 算", "US stores charge $5.25–$5.95; we use $5.45"],
  },
  // 以下 2026-10 核对（CBS、Tasting Table、CNN、USPS、ABC7、NPR、NBC、Fortune 等）
  {
    id: "costco-chicken",
    emoji: "🍗",
    price: 4.99,
    zh: "一只 Costco 烤鸡",
    en: ["a Costco rotisserie chicken", "Costco rotisserie chickens"],
    verb: ["吃", "eat"],
    fact: ["为守住这个价，Costco 自建了 4.5 亿美元的养鸡厂", "Costco built a $450M poultry plant to keep it at $4.99"],
  },
  {
    id: "costco-membership",
    emoji: "💳",
    price: 65,
    zh: "一年的 Costco 金星会员",
    en: ["a year of Costco Gold Star", "years of Costco Gold Star"],
    verb: ["续", "cover"],
    fact: ["2024 年从 $60 涨到 $65，是 2017 年后头一回涨价", "$60 → $65 in 2024, its first hike since 2017"],
  },
  {
    id: "sams-hotdog",
    emoji: "🥤",
    price: 1.38,
    zh: "一份山姆会员店热狗套餐",
    en: ["a Sam's Club hot dog combo", "Sam's Club hot dog combos"],
    verb: ["吃", "eat"],
    fact: ["2022 年降价，就为比 Costco 便宜 12 美分", "Cut in 2022 just to undercut Costco by 12¢"],
  },
  {
    id: "dollar-tree",
    emoji: "🏷️",
    price: 1.25,
    zh: "一件 Dollar Tree 基础价商品",
    en: ["a base-price Dollar Tree item", "base-price Dollar Tree items"],
    fact: ["坚守 1 美元 35 年，2021 年底才涨到 $1.25", "$1 for 35 years, then $1.25 from late 2021"],
  },
  {
    id: "tj-banana",
    emoji: "🍌",
    price: 0.23,
    zh: "一根 Trader Joe's 香蕉",
    en: ["a Trader Joe's banana", "Trader Joe's bananas"],
    fact: ["19 美分卖了 20 多年，2024 年才涨到 23 美分", "19¢ for 20+ years, then 23¢ in 2024"],
  },
  {
    id: "forever-stamp",
    emoji: "📮",
    price: 0.82,
    zh: "一张美国 Forever 邮票",
    en: ["a USPS Forever stamp", "USPS Forever stamps"],
    fact: ["2007 年首发时 41 美分，如今正好翻倍", "Debuted at 41¢ in 2007; the price has exactly doubled"],
  },
  {
    id: "nyc-subway",
    emoji: "🚇",
    price: 3,
    zh: "一趟纽约地铁",
    en: ["a NYC subway ride", "NYC subway rides"],
    verb: ["坐", "take"],
    fact: ["2026 年 1 月涨到 $3，MetroCard 同时退役", "Hit $3 in Jan 2026 as the MetroCard retired"],
  },
  {
    id: "masters-sandwich",
    emoji: "🥪",
    price: 1.5,
    zh: "一个大师赛皮门托芝士三明治",
    en: ["a Masters pimento cheese sandwich", "Masters pimento cheese sandwiches"],
    verb: ["吃", "eat"],
    fact: ["高尔夫名物，2002 年起一直卖 $1.50", "Golf's famous sandwich: $1.50 at Augusta since 2002"],
  },
];

// 历史价格：当年的标价，不折算通胀。出处主要是维基百科对应词条，另有 Hershey 档案馆、NBC、Fortune、TechCrunch、KTLA 等（2026-10 查）
const H = (
  id: string,
  emoji: string,
  price: number,
  year: string,
  zh: string,
  en: [string, string],
  fact: [string, string],
  extra: Partial<Item> = {},
): Item => ({ id, emoji, price, year, zh, en, fact, ...extra });

const history: Item[] = [
  H("us-stamp-3c", "✉️", 0.03, "1932-1958", "一张美国平信邮票", ["a first-class US stamp", "first-class US stamps"], [
    "寄一封信 3 美分，这价钱管了 26 年",
    "Mailing a letter cost 3¢ for 26 straight years",
  ]),
  H("coca-cola-5c", "🥤", 0.05, "1886-1959", "一份可口可乐", ["a Coke", "Cokes"], ["5 美分的价格，从 1886 年守到 1959 年", "5¢ from 1886 to 1959: 73 years"], {
    verb: ["喝", "drink"],
  }),
  H("hershey-5c", "🍫", 0.05, "1900-1969", "一块好时巧克力", ["a Hershey's bar", "Hershey's bars"], [
    "价格一直不动，可可一涨就把巧克力做小",
    "The price held at 5¢; the bar shrank when cocoa got pricey",
  ], { verb: ["吃", "eat"] }),
  H("nyc-subway-5c", "🚇", 0.05, "1904-1948", "一张纽约地铁票", ["a NYC subway ride", "NYC subway rides"], ["5 美分的票价维持了 44 年", "The 5¢ fare lasted 44 years"], {
    verb: ["坐", "take"],
  }),
  H("action-comics-1", "🦸", 0.1, "1938", "一本《动作漫画》第 1 期", ["a copy of Action Comics #1", "copies of Action Comics #1"], [
    "超人首次登场；2024 年一本拍出 600 万美元",
    "Superman's debut; one copy sold for $6M in 2024",
  ]),
  H("mcdonalds-15c", "🍔", 0.15, "1948", "一个麦当劳汉堡", ["a McDonald's hamburger", "McDonald's hamburgers"], [
    "1948 年砍菜单、拼速度，汉堡只要 15 美分",
    "1948: a slimmed-down menu built for speed, burgers 15¢",
  ], { verb: ["吃", "eat"] }),
  H("pong", "🏓", 0.25, "1972", "一局 Pong 街机", ["a game of Pong", "games of Pong"], [
    "原型机「坏了」，原来是投币箱被硬币塞爆",
    "The prototype 'broke': its coin box was jammed with quarters",
  ], { verb: ["玩", "play"] }),
  H("juicy-fruit", "🛒", 0.67, "1974", "一条黄箭口香糖", ["a 10-pack of Juicy Fruit", "10-packs of Juicy Fruit"], [
    "人类第一件扫条形码结账的商品",
    "The first product ever scanned at a checkout",
  ]),
  H("kodak-brownie", "📷", 1, "1900", "一台柯达布朗尼相机", ["a Kodak Brownie camera", "Kodak Brownie cameras"], [
    "1 美元的相机，让普通人也拍得起照片",
    "The $1 camera that brought snapshots to everyone",
  ]),
  H("slinky", "🌀", 1, "1945", "一个 Slinky 弹簧玩具", ["a Slinky", "Slinkys"], ["首次上架 90 分钟卖出 400 个", "Sold 400 in its first 90 minutes"]),
  H("disneyland-1955", "🏰", 1, "1955", "一张迪士尼乐园门票", ["a Disneyland ticket", "Disneyland tickets"], [
    "门票 1 美元，但每玩一个项目都要另付钱",
    "Entry was $1, but every ride cost extra",
  ]),
  H("million-dollar-homepage", "🟦", 1, "2005", "一个像素的广告位", ["a pixel of ad space", "pixels of ad space"], [
    "百万美元主页：一个大学生把首页切成 100 万像素，$1 一个",
    "A student sold a million pixels at $1 each",
  ]),
  H("barbie", "👗", 3, "1959", "一个芭比娃娃", ["a Barbie doll", "Barbie dolls"], ["名字取自创始人的女儿 Barbara", "Named after creator Ruth Handler's daughter, Barbara"]),
  H("pet-rock", "🪨", 3.95, "1975", "一块宠物石头", ["a Pet Rock", "Pet Rocks"], ["就是一块装在纸盒里的石头", "Literally a rock in a cardboard box"]),
  H("first-oscars", "🏆", 5, "1929", "一张第一届奥斯卡门票", ["a ticket to the first Oscars", "tickets to the first Oscars"], [
    "那届颁奖典礼只开了 15 分钟",
    "The whole ceremony took 15 minutes",
  ]),
  H("motel-6", "🏨", 6, "1962", "一晚 Motel 6", ["a night at Motel 6", "nights at Motel 6"], ["店名就是房价：一晚 6 美元", "The name was the price: $6 a night"], {
    verb: ["住", "book"],
  }),
  H("first-super-bowl", "🏈", 12, "1967", "一张第一届超级碗门票", ["a first Super Bowl ticket", "first Super Bowl tickets"], [
    "最贵的票 12 美元，那场还没坐满",
    "Top price was $12, and the stadium still wasn't full",
  ]),
  H("google-com", "🔎", 12, "2015", "google.com 这个域名", ["the google.com domain", "the google.com domain"], [
    "买到后只拥有了一分钟，Google 还奖了他 1.2 万多美元",
    "Owned it for one minute; Google paid him over $12,000",
  ], { unique: true }),
  H("ebay-laser", "🔦", 14.83, "1995", "一支坏掉的激光笔", ["a broken laser pointer", "broken laser pointers"], [
    "eBay 第一件成交品，买家专门收藏坏激光笔",
    "eBay's first sale; the buyer collected broken laser pointers",
  ]),
  H("woodstock", "🎸", 18, "1969", "一张伍德斯托克三日票", ["a 3-day Woodstock ticket", "3-day Woodstock tickets"], [
    "围栏没修好，最后干脆成了免费演出",
    "The fences weren't ready, so it became a free concert",
  ]),
  H("apple-ipo", "🍏", 22, "1980", "一股苹果上市发行股", ["a share of Apple at its IPO", "shares of Apple at its IPO"], [
    "1980 年 12 月上市，发行价每股 $22",
    "Apple went public in Dec 1980 at $22 a share",
  ]),
  H("nike-swoosh", "✔️", 35, "1971", "耐克勾勾 Logo 的设计", ["the Nike Swoosh design", "the Nike Swoosh design"], [
    "1983 年耐克又送了设计师 500 股股票",
    "In 1983 Nike also gave its designer 500 shares",
  ], { unique: true }),
  H("bitcoin-pizza", "🍕", 41, "2010", "一单比特币披萨", ["the Bitcoin pizza order", "Bitcoin pizza orders"], [
    "两个披萨付了 1 万枚比特币，当时约值 $41",
    "Two pizzas for 10,000 BTC, about $41 back then",
  ]),
  H("google-ipo", "📈", 85, "2004", "一股 Google 上市发行股", ["a share of Google at its IPO", "shares of Google at its IPO"], [
    "2004 年用荷兰式拍卖定价上市",
    "Priced through a Dutch auction in 2004",
  ]),
  H("game-boy", "👾", 89.99, "1989", "一台 Game Boy", ["a Game Boy", "Game Boys"], ["北美版随机送了《俄罗斯方块》", "Came with Tetris in the box in North America"]),
  H("windows-1", "🪟", 99, "1985", "一套 Windows 1.0", ["a copy of Windows 1.0", "copies of Windows 1.0"], ["Windows 的第一个版本", "The very first Windows"]),
  H("nes", "🕹️", 179.99, "1985", "一套 NES 豪华版游戏机", ["an NES Deluxe Set", "NES Deluxe Sets"], [
    "首发套装里还送了一个机器人 R.O.B.",
    "The launch bundle even came with R.O.B. the robot",
  ]),
  H("walkman", "📻", 200, "1980", "一台索尼随身听", ["a Sony Walkman", "Sony Walkmans"], ["在美国首发时叫 Sound-about", "It first went on sale in the US as the 'Sound-about'"]),
  H("model-t", "🚗", 260, "1925", "一辆福特 T 型车", ["a Ford Model T", "Ford Model Ts"], ["1909 年要 $825，1925 年降到 $260", "$825 in 1909, down to $260 by 1925"]),
  H("playstation", "📀", 299, "1995", "一台初代 PlayStation", ["an original PlayStation", "original PlayStations"], [
    "E3 上索尼只说了一句「299」，全场鼓掌",
    "Sony's whole E3 pitch: 'Two ninety-nine.' Applause.",
  ]),
  H("ipod", "🎵", 399, "2001", "一台初代 iPod", ["an original iPod", "original iPods"], ["广告词：把 1000 首歌装进口袋", "“1,000 songs in your pocket”"]),
  H("first-airline-ticket", "✈️", 400, "1914", "美国首条定期航线的第一张机票", ["the first US airline's first ticket", "the first US airline's first ticket"], [
    "被前市长拍下；平时单程只要 5 美元",
    "Won at auction by an ex-mayor; the usual fare was $5",
  ], { unique: true }),
  H("altair-8800", "🔧", 439, "1975", "一套 Altair 8800 电脑套件", ["an Altair 8800 kit", "Altair 8800 kits"], [
    "盖茨和艾伦给它写了 BASIC，微软由此起步",
    "Gates and Allen wrote its BASIC: Microsoft's first product",
  ]),
  H("original-iphone", "📱", 499, "2007", "一部初代 iPhone（4GB）", ["an original 4GB iPhone", "original 4GB iPhones"], [
    "降价后，苹果给早期买家补了 100 美元",
    "After a price cut, Apple gave early buyers $100 credit",
  ]),
  H("commodore-64", "💾", 595, "1982", "一台 Commodore 64", ["a Commodore 64", "Commodore 64s"], [
    "吉尼斯认证：史上最畅销的台式电脑型号",
    "Guinness: the best-selling desktop computer model ever",
  ]),
  H("apple-1", "🍎", 666.66, "1976", "一台 Apple-1", ["an Apple-1", "Apple-1s"], ["沃兹喜欢重复数字，于是定价 $666.66", "Priced that way because Wozniak liked repeating digits"]),
  H("ronald-wayne", "📜", 800, "1976", "罗纳德·韦恩的 10% 苹果股份", ["Ronald Wayne's 10% of Apple", "Ronald Wayne's 10% of Apple"], [
    "这 10% 本是让他在乔布斯和沃兹间投决胜票的",
    "His 10% was meant to break ties between Jobs and Woz",
  ], { unique: true }),
  H("ibm-pc", "🖥️", 1565, "1981", "一台 IBM PC", ["an IBM PC", "IBM PCs"], ["起步款只有 16KB 内存，连软驱都没有", "Base model: 16 KB of RAM and no disk drive at all"]),
  H("macintosh", "🖱️", 2495, "1984", "一台初代 Macintosh", ["an original Macintosh", "original Macintoshes"], [
    "开卖前两天，超级碗广告《1984》为它造势",
    "Went on sale two days after the '1984' Super Bowl ad",
  ]),
  H("dynatac", "📞", 3995, "1984", "一部摩托罗拉「大哥大」DynaTAC", ["a Motorola DynaTAC", "Motorola DynaTACs"], [
    "外号「砖头」：充电 10 小时，通话 30 分钟",
    "Nicknamed 'the brick': 10-hour charge, 30 minutes of talk",
  ]),
  H("apple-lisa", "💼", 9995, "1983", "一台 Apple Lisa", ["an Apple Lisa", "Apple Lisas"], ["名字来自乔布斯的女儿 Lisa", "Named after Steve Jobs's daughter, Lisa"]),
  H("wright-flyer", "🛩️", 30000, "1909", "一架莱特军用飞机", ["a Wright Military Flyer", "Wright Military Flyers"], [
    "世界上第一架被军方验收服役的飞机",
    "The first airplane ever accepted into military service",
  ]),
  H("86-dos", "💽", 50000, "1981", "86-DOS 的全部版权", ["full rights to 86-DOS", "full rights to 86-DOS"], [
    "后来改名 MS-DOS，也成了 IBM 的 PC DOS",
    "It became MS-DOS, and IBM's PC DOS",
  ], { unique: true }),
  H("babe-ruth", "⚾", 100000, "1919", "贝比·鲁斯的合同", ["Babe Ruth's contract", "Babe Ruth's contract"], [
    "红袜随后 86 年没夺冠，人称「贝比魔咒」",
    "Boston then went 86 years without a title",
  ], { unique: true }),
  H("google-excite", "🔍", 750000, "1999", "整个 Google", ["all of Google", "all of Google"], [
    "开价 100 万被拒，砍到 75 万 Excite 还是不要",
    "Excite said no at $1M, then again at $750K",
  ], { unique: true }),
  H("first-tweet-nft", "🐦", 2915835.47, "2021", "推特第一条推文的 NFT", ["the NFT of Twitter's first tweet", "the NFT of Twitter's first tweet"], [
    "内容只有一句：just setting up my twttr",
    "It said: 'just setting up my twttr'",
  ], { unique: true }),
  // 美国国家档案馆：720 万美元买下近 60 万平方英里，不到 2 美分一英亩
  H("alaska-acre", "🐻", 0.019, "1867", "一英亩阿拉斯加", ["an acre of Alaska", "acres of Alaska"], [
    "720 万美元买下整个阿拉斯加，被嘲笑是「西沃德的冰箱」",
    "Bought whole for $7.2M and mocked as 'Seward's Icebox'",
  ]),
  // 路透社 2022：马斯克收购推特，每股 $54.20
  H("twitter-buyout", "🐤", 54.2, "2022", "一股马斯克收购价的推特股票", ["a Twitter share (Musk's buyout)", "Twitter shares (Musk's buyout)"], [
    "$54.20 这个数里藏着「420」的梗",
    "The $54.20 hides a '420' joke",
  ]),
  // 每英亩几美分各处说法不一（3～4 美分），只说面积翻倍
  H("louisiana", "🗺️", 15000000, "1803", "整个路易斯安那领地", ["the Louisiana Purchase", "the Louisiana Purchase"], [
    "一笔买卖，美国面积直接翻了一倍",
    "One deal, and the US doubled in size",
  ], { unique: true }),
];

const tech: Item[] = [
  // claude.com/pricing："$20 if billed monthly"
  {
    id: "claude-pro",
    emoji: "🧡",
    price: 20,
    zh: "一个月的 Claude Pro",
    en: ["a month of Claude Pro", "months of Claude Pro"],
    verb: ["续", "cover"],
    fact: ["月付 $20，年付合 $17 一个月", "$20 monthly, or $17/mo billed yearly"],
  },
  // claude.com/pricing："From $100 Per month"；帮助中心 What is the Max plan：5x $100、20x $200
  {
    id: "claude-max-5x",
    emoji: "💎",
    price: 100,
    zh: "一个月的 Claude Max 5x",
    en: ["a month of Claude Max 5x", "months of Claude Max 5x"],
    verb: ["续", "cover"],
    fact: ["用量是 Pro 的 5 倍，价格也正好 5 倍", "5× the Pro usage for exactly 5× the price"],
  },
  {
    id: "claude-max-20x",
    emoji: "🚀",
    price: 200,
    zh: "一个月的 Claude Max 20x",
    en: ["a month of Claude Max 20x", "months of Claude Max 20x"],
    verb: ["续", "cover"],
    fact: ["用量是 Pro 的 20 倍，价格只要 10 倍", "20× the Pro usage for only 10× the price"],
  },
  // github.com/features/copilot/plans："$10 per month"
  {
    id: "copilot-pro",
    emoji: "🤖",
    price: 10,
    zh: "一个月的 GitHub Copilot Pro",
    en: ["a month of GitHub Copilot Pro", "months of GitHub Copilot Pro"],
    verb: ["续", "cover"],
    fact: ["2026 年 6 月起改成按 AI 额度计费，月费没变", "Moved to AI-credit billing in Jun 2026; price unchanged"],
  },
  // 任天堂美国客服页：个人 12 个月 + 扩展包 $49.99
  {
    id: "nso-expansion",
    emoji: "🍄",
    price: 49.99,
    zh: "一年的 Switch Online + 扩展包",
    en: ["a year of Switch Online + Expansion", "years of Switch Online + Expansion"],
    verb: ["续", "cover"],
    fact: ["N64、GBA 老游戏都在里面", "Comes with N64 and GBA classics"],
  },
  // nintendo.com 价格调整公告：2026-09-01 起 $449.99 → $499.99
  {
    id: "switch-2",
    emoji: "🎮",
    price: 499.99,
    zh: "一台 Nintendo Switch 2",
    en: ["a Nintendo Switch 2", "Nintendo Switch 2 consoles"],
    fact: ["2026 年 9 月 1 日从 $449.99 涨到 $499.99", "Went from $449.99 to $499.99 on Sep 1, 2026"],
  },
  // apple.com 购买页："From $799"（Apple Watch Ultra 4）
  {
    id: "watch-ultra-4",
    emoji: "⌚",
    price: 799,
    zh: "一块 Apple Watch Ultra 4",
    en: ["an Apple Watch Ultra 4", "Apple Watch Ultra 4s"],
    fact: ["苹果官网起售价 $799", "Starts at $799 on apple.com"],
  },
  // 以下 2026-10 核对：官方定价页，或官方页打不开时用 2026 年的报道（TechCrunch、TNW、9to5Mac、Tom's Hardware 等）
  {
    id: "chatgpt-plus",
    emoji: "💬",
    price: 20,
    zh: "一个月的 ChatGPT Plus",
    en: ["a month of ChatGPT Plus", "months of ChatGPT Plus"],
    verb: ["续", "cover"],
    fact: ["2023 年推出时就是 $20，到现在没涨过", "Launched at $20 in 2023 and still hasn't gone up"],
  },
  {
    id: "chatgpt-pro-500",
    emoji: "💸",
    price: 500,
    zh: "一个月的 ChatGPT Pro 500",
    en: ["a month of ChatGPT Pro 500", "months of ChatGPT Pro 500"],
    verb: ["续", "cover"],
    fact: ["2026 年 9 月新出的档位，一年要 $6,000", "New tier from Sept 2026: $6,000 a year"],
  },
  {
    id: "cursor-premium",
    emoji: "🧑‍💻",
    price: 30,
    zh: "一个月的 Cursor Premium",
    en: ["a month of Cursor Premium", "months of Cursor Premium"],
    verb: ["续", "cover"],
    fact: ["2026 年 10 月起和 Grok、X 捆成一个订阅", "Since Oct 2026 it's bundled with Grok and X Premium"],
  },
  {
    id: "apple-developer",
    emoji: "🛠️",
    price: 99,
    zh: "一年的苹果开发者会员",
    en: ["a year of the Apple Developer Program", "years of the Apple Developer Program"],
    verb: ["续", "cover"],
    fact: ["2008 年公布时就是 $99 一年，到现在没变", "Already $99/year when announced in 2008"],
  },
  {
    id: "google-play-dev",
    emoji: "🤖",
    price: 25,
    zh: "一次 Google Play 开发者注册",
    en: ["a Google Play developer signup", "Google Play developer signups"],
    fact: ["只收一次，苹果可是每年收 $99", "Paid once; Apple charges $99 every year"],
  },
  {
    id: "steam-direct",
    emoji: "🎲",
    price: 100,
    zh: "一次 Steam 游戏上架费",
    en: ["a Steam Direct fee", "Steam Direct fees"],
    fact: ["游戏收入满 $1,000 后，这 $100 会退给你", "Refunded once the game earns $1,000"],
  },
  {
    id: "jetbrains-all",
    emoji: "🧰",
    price: 299,
    zh: "一年的 JetBrains 全家桶（个人版）",
    en: ["a year of JetBrains All Products Pack", "years of JetBrains All Products Pack"],
    verb: ["续", "cover"],
    fact: ["连续订阅到第三年，续费降到 $179", "Keep subscribing and year three drops to $179"],
  },
  {
    id: "aws-ipv4",
    emoji: "🌐",
    price: 3.65,
    zh: "一个月的 AWS 公网 IPv4 地址",
    en: ["a month of an AWS public IPv4 address", "months of an AWS public IPv4 address"],
    verb: ["租", "rent"],
    fact: ["2024 年 2 月起，正在用的公网 IPv4 也要收钱", "Since Feb 2024 AWS bills even in-use public IPv4s"],
  },
  {
    id: "pi5-16gb",
    emoji: "🍓",
    price: 305,
    zh: "一块 16GB 树莓派 5",
    en: ["a 16GB Raspberry Pi 5", "16GB Raspberry Pi 5s"],
    fact: ["首发才 $120，内存涨价让它涨到 2.5 倍", "Launched at $120; memory costs pushed it past 2.5×"],
  },
  {
    id: "pi5-1gb",
    emoji: "🥧",
    price: 45,
    zh: "一块 1GB 树莓派 5",
    en: ["a 1GB Raspberry Pi 5", "1GB Raspberry Pi 5s"],
    fact: ["2026 年树莓派涨了三轮价，1GB 版一分没涨", "Three Pi price hikes in 2026, and the 1GB dodged them all"],
  },
  {
    id: "arduino-r4",
    emoji: "🔧",
    price: 20,
    zh: "一块 Arduino UNO R4 Minima",
    en: ["an Arduino UNO R4 Minima", "Arduino UNO R4 Minimas"],
    fact: ["2025 年 10 月，高通宣布收购 Arduino", "Qualcomm announced it was buying Arduino in Oct 2025"],
  },
  {
    id: "flipper-zero",
    emoji: "🐬",
    price: 169,
    zh: "一台 Flipper Zero",
    en: ["a Flipper Zero", "Flipper Zeros"],
    fact: ["里面养着一只电子海豚，冷落它会生气", "It hosts a pet dolphin that sulks if you neglect it"],
  },
  {
    id: "steam-deck-oled",
    emoji: "🕹️",
    price: 789,
    zh: "一台 Steam Deck OLED（512GB）",
    en: ["a Steam Deck OLED (512GB)", "Steam Deck OLEDs (512GB)"],
    fact: ["2026 年 5 月因内存涨价，从 $549 涨到 $789", "Jumped from $549 to $789 in May 2026 on memory costs"],
  },
  {
    id: "iphone-18-pro",
    emoji: "📱",
    price: 1199,
    zh: "一部 iPhone 18 Pro",
    en: ["an iPhone 18 Pro", "iPhone 18 Pros"],
    fact: ["A20 Pro 芯片用上了 2nm 工艺", "Its A20 Pro chip is built on a 2nm process"],
  },
  {
    id: "macbook-neo",
    emoji: "💻",
    price: 699,
    zh: "一台 MacBook Neo",
    en: ["a MacBook Neo", "MacBook Neos"],
    fact: ["用的是 iPhone 16 Pro 同款 A18 Pro 芯片", "Runs on the A18 Pro, same chip as the iPhone 16 Pro"],
  },
  {
    id: "macbook-air-13",
    emoji: "🪶",
    price: 1299,
    zh: "一台 13 英寸 MacBook Air",
    en: ["a 13-inch MacBook Air", "13-inch MacBook Airs"],
    fact: ["2026 年 6 月因内存涨价，起售价涨了 $200", "Starting price rose $200 in June 2026, citing memory"],
  },
  {
    id: "macbook-pro-14",
    emoji: "👨‍💻",
    price: 1999,
    zh: "一台 14 英寸 MacBook Pro",
    en: ["a 14-inch MacBook Pro", "14-inch MacBook Pros"],
    fact: ["2026 年 6 月从 $1,699 涨到 $1,999", "Went from $1,699 to $1,999 in June 2026"],
  },
  {
    id: "mac-mini-m6",
    emoji: "🧊",
    price: 899,
    zh: "一台 Mac mini（M6）",
    en: ["a Mac mini (M6)", "Mac minis (M6)"],
    fact: ["2024 年的 M4 版入门价才 $599", "The 2024 M4 model started at just $599"],
  },
  {
    id: "airpods-pro-3",
    emoji: "🎧",
    price: 249,
    zh: "一副 AirPods Pro 3",
    en: ["a pair of AirPods Pro 3", "pairs of AirPods Pro 3"],
    fact: ["2026 年苹果大涨价，AirPods 一分没涨", "Apple's 2026 price hikes skipped AirPods"],
  },
  {
    id: "quest-3s",
    emoji: "🥽",
    price: 349.99,
    zh: "一台 Meta Quest 3S（128GB）",
    en: ["a Meta Quest 3S (128GB)", "Meta Quest 3S headsets (128GB)"],
    fact: ["2026 年 4 月从 $299.99 涨到 $349.99", "Rose from $299.99 to $349.99 in Apr 2026"],
  },
  {
    id: "kindle",
    emoji: "📖",
    price: 149.99,
    zh: "一台 Kindle（基础款）",
    en: ["a basic Kindle", "basic Kindles"],
    fact: ["2026 年 8 月一夜之间涨了 $40", "Jumped $40 overnight in Aug 2026"],
  },
  {
    id: "rtx-5090",
    emoji: "🔥",
    price: 1999,
    zh: "一张 RTX 5090 公版显卡",
    en: ["an RTX 5090 Founders Edition", "RTX 5090 Founders Editions"],
    fact: ["这是建议零售价；2026 年元旦 Newegg 标价 $3,695", "That's MSRP; Newegg listed it at $3,695 on Jan 1, 2026"],
  },
  {
    id: "netflix-standard",
    emoji: "🍿",
    price: 19.99,
    zh: "一个月的 Netflix 标准版",
    en: ["a month of Netflix Standard", "months of Netflix Standard"],
    verb: ["续", "cover"],
    fact: ["无广告，可以两台设备同时看", "No ads, two screens at once"],
  },
  {
    id: "spotify-premium",
    emoji: "🎶",
    price: 12.99,
    zh: "一个月的 Spotify Premium",
    en: ["a month of Spotify Premium", "months of Spotify Premium"],
    verb: ["续", "cover"],
    fact: ["2026 年初从 $11.99 涨到 $12.99", "Went from $11.99 to $12.99 in early 2026"],
  },
  {
    id: "youtube-premium",
    emoji: "▶️",
    price: 15.99,
    zh: "一个月的 YouTube Premium",
    en: ["a month of YouTube Premium", "months of YouTube Premium"],
    verb: ["续", "cover"],
    fact: ["2026 年从 $13.99 涨到 $15.99", "Climbed from $13.99 to $15.99 in 2026"],
  },
];

// 太空、拍卖纪录、大工程之类的怪东西（2026-10 核对：SpaceX 订票接口、NASA、Planetary Society、CBS、NBC、Spaceflight Now、
// 吉尼斯、Scientific American、TVLine 等）。大多买不起，正好用"攒到百分之几"
const odd: Item[] = [
  {
    id: "penny-mint",
    emoji: "🪙",
    price: 0.0369,
    zh: "一枚美分硬币",
    en: ["a US penny", "US pennies"],
    verb: ["铸", "mint"],
    fact: ["铸一枚要 3.69 美分；2025 年 11 月美国铸完了最后一枚流通美分", "Each cost 3.69¢ to make; the last one was struck in Nov 2025"],
  },
  {
    id: "moon-acre",
    emoji: "🌙",
    price: 34.99,
    zh: "一英亩月球「地产」",
    en: ["a novelty acre of the Moon", "novelty acres of the Moon"],
    fact: ["卖家从 1980 年起就在「卖月球」，买到的是一张证书", "Its seller has 'sold' the Moon since 1980: you get a certificate"],
  },
  {
    id: "grilled-cheese",
    emoji: "🧀",
    price: 214,
    zh: "一份世界上最贵的烤芝士三明治",
    en: ["the world's priciest grilled cheese", "the world's priciest grilled cheeses"],
    verb: ["吃", "eat"],
    fact: ["吉尼斯纪录：面包里加了唐培里侬香槟和金箔", "Guinness record: Dom Pérignon and gold flakes in the bread"],
  },
  {
    id: "monkey-name",
    emoji: "🐒",
    price: 650000,
    zh: "一个新猴种的命名权",
    en: ["naming rights to a new monkey species", "naming rights to new monkey species"],
    fact: ["2005 年被一家网络赌场拍下，学名意思是「金宫」", "An online casino won it in 2005; the name means 'golden palace'"],
  },
  {
    id: "mount-rushmore",
    emoji: "🗿",
    price: 989992.32,
    zh: "一座总统山",
    en: ["a Mount Rushmore", "Mount Rushmores"],
    fact: ["1927～1941 年，约 400 名工人用炸药和钻头雕成", "Carved 1927–1941 by ~400 workers with dynamite and drills"],
  },
  {
    id: "bluefin-tuna",
    emoji: "🐟",
    price: 3_200_000,
    zh: "一条创纪录的蓝鳍金枪鱼",
    en: ["a record-setting bluefin tuna", "record-setting bluefin tunas"],
    fact: ["2026 年东京新年拍卖，243 公斤，5.1 亿日元", "Tokyo's 2026 New Year auction: 243 kg, ¥510 million"],
  },
  {
    id: "comedian-banana",
    emoji: "🍌",
    price: 6_200_000,
    zh: "一件胶带贴香蕉艺术品《喜剧演员》",
    en: ["Cattelan's duct-taped banana", "Cattelan's duct-taped bananas"],
    fact: ["买家拿到手几天后，当众把香蕉吃了", "The buyer ate the banana at a press event days later"],
  },
  {
    id: "super-bowl-ad",
    emoji: "📺",
    price: 8_000_000,
    zh: "一条 30 秒超级碗广告",
    en: ["a 30-second Super Bowl ad", "30-second Super Bowl ads"],
    fact: ["2026 年有几个广告位卖到了 1000 万美元以上", "A few 2026 slots went for over $10 million"],
  },
  {
    id: "guiana-stamp",
    emoji: "💎",
    price: 8_307_000,
    zh: "一枚英属圭亚那 1 分洋红邮票",
    en: ["the British Guiana 1c magenta", "British Guiana 1c magentas"],
    fact: ["面值只有 1 分，世上只剩这一枚", "Face value: one cent. Only one is known to exist"],
  },
  {
    id: "blue-origin-seat",
    emoji: "💺",
    price: 28_000_000,
    zh: "蓝色起源首次载人飞行的座位",
    en: ["Blue Origin's first crewed seat", "Blue Origin's first crewed seat"],
    fact: ["拍下的人说「档期冲突」没去，座位给了一个 18 岁学生", "The winner cited 'scheduling conflicts'; an 18-year-old flew"],
    unique: true,
  },
  {
    id: "gus-trex",
    emoji: "🦖",
    price: 50_130_000,
    zh: "一具霸王龙化石「Gus」",
    en: ["Gus the T. rex skeleton", "Gus the T. rex skeletons"],
    fact: ["约 6700 万岁，2026 年 7 月刷新恐龙化石拍卖纪录", "~67M years old; priciest dinosaur ever sold (2026)"],
  },
  {
    id: "falcon-9",
    emoji: "🚀",
    price: 74_000_000,
    zh: "一次猎鹰 9 号专属发射",
    en: ["a dedicated Falcon 9 launch", "dedicated Falcon 9 launches"],
    fact: ["2022 年同样的发射报价还只要 6700 万美元", "The same launch was listed at $67M in 2022"],
  },
  {
    id: "ingenuity",
    emoji: "🚁",
    price: 80_000_000,
    zh: "一架机智号火星直升机",
    en: ["an Ingenuity Mars helicopter", "Ingenuity Mars helicopters"],
    fact: ["原计划飞 5 次，最后在火星飞了 72 次", "Planned for 5 flights, it flew 72 times on Mars"],
  },
  {
    id: "salvator-mundi",
    emoji: "🎨",
    price: 450_300_000,
    zh: "一幅达·芬奇《救世主》",
    en: ["Leonardo's Salvator Mundi", "Salvator Mundis"],
    fact: ["1958 年它只拍出了 45 英镑", "In 1958 it sold for just £45"],
  },
  {
    id: "burj-khalifa",
    emoji: "🏙️",
    price: 1_500_000_000,
    zh: "一座哈利法塔",
    en: ["a Burj Khalifa", "Burj Khalifas"],
    fact: ["828 米高，约 1.2 万名工人建成", "828 m tall, built by about 12,000 workers"],
  },
  {
    id: "perseverance",
    emoji: "🪐",
    price: 2_725_000_000,
    zh: "一辆毅力号火星车",
    en: ["a Perseverance Mars rover", "Perseverance Mars rovers"],
    fact: ["机智号直升机就是搭它的顺风车上的火星", "It carried the Ingenuity helicopter to Mars"],
  },
  {
    id: "artemis-launch",
    emoji: "🌕",
    price: 4_100_000_000,
    zh: "一次阿耳忒弥斯登月火箭发射",
    en: ["an Artemis SLS/Orion launch", "Artemis SLS/Orion launches"],
    fact: ["光 SLS 火箭本身就要约 22 亿美元", "The SLS rocket alone is about $2.2 billion of it"],
  },
  {
    id: "jwst",
    emoji: "🔭",
    price: 9_700_000_000,
    zh: "一台詹姆斯·韦布太空望远镜",
    en: ["a James Webb telescope", "James Webb telescopes"],
    fact: ["2021 年圣诞节当天发射升空", "It launched on Christmas Day 2021"],
  },
];

/** SpaceX 拼车入轨每公斤多少美元（SpaceX 订票页背后的报价接口，2026 年航班；最少订 50 公斤） */
const RIDESHARE_PER_KG = 7000;
/** NASA 2019 年估的国际空间站一晚的钱（不含往返船票） */
const ISS_PER_NIGHT = 35_000;

const oddRates: Rate[] = [
  {
    id: "spacex-rideshare",
    emoji: "🛰️",
    make: (cost, lang) =>
      lang === "zh"
        ? { text: `够把 ${grams((cost / RIDESHARE_PER_KG) * 1000, lang)}东西搭 SpaceX 拼车送进轨道`, fact: "最少订 50 公斤，2027 年起每公斤 $7,500" }
        : {
            text: `Enough to fly ${grams((cost / RIDESHARE_PER_KG) * 1000, lang)} to orbit on a SpaceX rideshare`,
            fact: "50 kg minimum; $7,500/kg from 2027",
          },
  },
  {
    id: "iss-stay",
    emoji: "🛏️",
    make: (cost, lang) =>
      lang === "zh"
        ? { text: `够在国际空间站住 ${span((cost / ISS_PER_NIGHT) * 86_400, lang)}`, fact: "按 NASA 2019 年估的一晚 $3.5 万，船票另算" }
        : { text: `Enough for ${span((cost / ISS_PER_NIGHT) * 86_400, lang)} aboard the ISS`, fact: "At NASA's 2019 estimate of $35K a night, ride not included" },
  },
];

export const CATALOG = { icons, history, tech, odd, oddRates };
