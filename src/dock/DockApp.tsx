// 小 Dock：平时是一张小卡片（今日费用 + 5h 限额），鼠标移上去向上展开明细，移开收回。
// 今天、本月跟着统计范围走；5h 窗口固定看 Claude Code 的。限额只用 Claude Code 给的官方数据，读不到就不显示。
// 亮暗跟着设置里的主题，和大 Dock 一起变（只换颜色）。
//
// 窗口是透明的，卡片和阴影都是页面自己画的。窗口一直是展开后的高度，卡片贴着底边，上面没用到的部分透明；
// 悬停时只是卡片自己用 CSS 长上去、收回来，不改窗口大小（改大小会闪）。
// 鼠标在不在卡片上由 Rust 端判断（shell.rs），不在卡片上时窗口对鼠标透明，点击穿到后面的程序
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { scopeLabel } from "../ccusage/agents";
import { BURN_COLOR, burnLevel, liveBlock } from "../ccusage/blocks";
import { minutesLeft, sevenDayBudget, useOfficialLimits, type Limits } from "../ccusage/limits";
import { subscriptionSpent } from "../ccusage/plans";
import { tokPerSec, tokPerSecValue, useSpeed, type Speed } from "../ccusage/speed";
import type { Block } from "../ccusage/types";
import { dayIso } from "../ccusage/ledger";
import { newer } from "../ccusage/versions";
import { useI18n } from "../i18n";
import { useSettings } from "../settings";
import { useTheme } from "../shell/useTheme";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { clock, duration, money, tokens, updatedAgo } from "../ui/format";
import { useNow } from "../ui/useNow";
import { hourBuckets } from "../pages/overview/data";
import { AgentsWorker, useAgents } from "../ccusage/agents";
import { LedgerWorker, useLedger } from "../ccusage/ledger";
import { useLimitsHook } from "../ccusage/limits";
import { useLatest } from "../ccusage/versions";
import { usageFor, type Usage } from "./data";
import { useCcusage, useDockDesktop } from "./duties";
import { crossedMilestone, randomQuip, type Quip, type QuipContext } from "./quips";
import styles from "./Dock.module.css";

/** 鼠标移开后多久收回 */
const CLOSE_DELAY_MS = 450;
/** 卡片四周给阴影留的透明边（上、下、左右），和 CSS 里 .stage 的 padding 一致 */
const PAD_TOP = 10;
const PAD_BOTTOM = 18;
const PAD_SIDE = 12;
/** Rust 端发的：鼠标进出卡片 */
const DOCK_HOVER = "dock-hover";
/** 跨过里程碑时冒出来的气泡停多久（和 CSS 里 bubbleLife 动画的时长一致） */
const BUBBLE_MS = 9_000;

/** 明细往哪边展开 */
type Dir = "up" | "down";

interface Actions {
  /** 打开大 Dock；带 tab 就切到那个页签 */
  open: (tab?: "settings") => void;
  hide: () => void;
}

interface ViewProps {
  scope: string;
  scopeName: string;
  usage: Usage | null;
  /** 进行中的 Claude Code 5h 窗口（ccusage 算的已用、燃烧速率） */
  block: Block | undefined;
  /** 官方的 5h / 7 天限额 */
  limits: Limits;
  /** 照这一轮 7 天窗口订阅的花费（剔除了非订阅会话）和百分比估的整个 7 天额度（美元）；估不了是 null */
  weekBudget: number | null;
  /** 进行中的 5h 窗口里订阅花了多少（剔除了非订阅会话） */
  blockUsed: number;
  /** 生成速度；近 1 小时没有回复就是 null */
  speed: Speed | null;
  /** 明细最上面那句趣味话；还没抽过是 null */
  quip: Quip | null;
  /** 点那句话：换一句 */
  nextQuip: () => void;
  /** 今天 24 小时每小时的费用（只有 Claude Code 有） */
  hourly: number[] | null;
  now: number;
  version: string | null;
  hasNew: boolean;
  actions: Actions;
  /** 明细展开了 */
  open: boolean;
  /** 鼠标在卡片上（卡片轻轻浮起） */
  hot: boolean;
  /** 明细那一块：量它的高度来定窗口要拉多高 */
  detailsRef: RefObject<HTMLDivElement | null>;
  /** 平时那一行：同上 */
  rowRef: RefObject<HTMLDivElement | null>;
  /** 下面的趣味句：同上 */
  quipRef: RefObject<HTMLDivElement | null>;
}

/**
 * 小 Dock 窗口的根：除了显示卡片，程序常驻的事都在这里做（大 Dock 收到托盘时整个窗口会关掉）——
 * 找 ccusage、取两本账本存进 localStorage 给大 Dock 看、定时查新版本、按设置接上状态栏、托盘和显示隐藏
 */
export function DockRoot() {
  const { settings } = useSettings();
  const install = useCcusage();
  const ready = !!install;
  const { latest } = useLatest(ready);
  useLimitsHook(settings.officialLimits);
  useDockDesktop(ready);
  return (
    <LedgerWorker enabled={ready}>
      <AgentsWorker scope={settings.scope} enabled={ready}>
        <DockApp version={install?.version ?? null} latest={latest.version ?? null} />
      </AgentsWorker>
    </LedgerWorker>
  );
}

/** version：在用的 ccusage 版本；latest：npm 上最新的版本（"可更新"用），都可能还不知道 */
function DockApp({ version, latest }: { version: string | null; latest: string | null }) {
  const { t, lang } = useI18n();
  const { settings, update } = useSettings();
  const { ledger } = useLedger();
  const { agents } = useAgents();
  const now = useNow(1_000);
  const limits = useOfficialLimits(now);
  const speed = useSpeed();
  // 亮暗和大 Dock 用同一个设置
  useTheme(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const quipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(false);
  const [sizes, setSizes] = useState({ row: 0, details: 0, quip: 0 });
  const closeTimer = useRef(0);

  // 一直在最上层（设置里能关）
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(settings.dockOnTop);
  }, [settings.dockOnTop]);

  // 量平时那一行、上面的明细、下面的趣味句的实际高度（收起时也有自己的高度，只是被裁掉了）
  useLayoutEffect(() => {
    const measure = () =>
      setSizes({
        row: rowRef.current?.offsetHeight ?? 0,
        details: detailsRef.current?.offsetHeight ?? 0,
        quip: quipRef.current?.offsetHeight ?? 0,
      });
    measure();
    const observer = new ResizeObserver(measure);
    for (const ref of [rowRef, detailsRef, quipRef]) if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  // 明细往哪边展开：平时往上；拖到屏幕顶上、上面放不下时往下（Rust 端按窗口位置和屏幕可用区域定，换方向时挪窗口让卡片不动）
  const [dir, setDir] = useState<Dir>("up");
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const orient = useCallback(() => {
    if (sizes.row === 0) return;
    void invoke<Dir>("orient_dock", {
      layout: {
        dir: dirRef.current,
        card: 2 + sizes.row,
        details: sizes.details,
        quip: sizes.quip,
        padTop: PAD_TOP,
        padBottom: PAD_BOTTOM,
      },
    }).then(setDir);
  }, [sizes]);
  const orientRef = useRef(orient);
  orientRef.current = orient;

  // 窗口高度一直按展开后的算：卡片（加 2px 边框，上面明细、下面趣味句都展开）+ 上下给阴影留的边。
  // 只有内容变了（比如 5h 窗口开始、结束）才改；改完再看一下方向对不对
  const height = PAD_TOP + PAD_BOTTOM + 2 + sizes.row + sizes.details + sizes.quip;
  useEffect(() => {
    if (sizes.row === 0) return;
    void invoke("fit_dock", { height, keepTop: dirRef.current === "down" }).then(() => orientRef.current());
  }, [height, sizes.row]);

  // 拖动停下来以后（移动事件停了 200ms）重新定方向
  useEffect(() => {
    let timer = 0;
    const stop = getCurrentWindow().onMoved(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => orientRef.current(), 200);
    });
    return () => {
      window.clearTimeout(timer);
      stop.then((f) => f());
    };
  }, []);

  // 告诉 Rust 端卡片现在占哪一块：收起时只有那一行，展开时连上面的明细、下面的趣味句一起。
  // 往上展开时，收起的那一行在明细那块地方的下面；往下展开时卡片一直贴着顶边
  useEffect(() => {
    if (sizes.row === 0) return;
    const h = 2 + sizes.row + (open ? sizes.details + sizes.quip : 0);
    const y = dir === "up" && !open ? PAD_TOP + sizes.details : PAD_TOP;
    void invoke("set_dock_hit", { rect: { x: PAD_SIDE, y, w: window.innerWidth - PAD_SIDE * 2, h } });
  }, [open, sizes, dir]);

  // 鼠标进来马上展开；移开等一会儿再收回（中途又进来就不收）
  useEffect(() => {
    const stop = listen<boolean>(DOCK_HOVER, (e) => {
      setHot(e.payload);
      window.clearTimeout(closeTimer.current);
      if (e.payload) setOpen(true);
      else closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    });
    return () => {
      stop.then((f) => f());
    };
  }, []);

  const actions: Actions = {
    open: (tab) => void invoke("show_main", { tab }),
    hide: () => {
      // 改设置（大 Dock 也会跟着隐藏它），同时自己先藏起来，不用等
      update({ dockVisible: false });
      void invoke("set_dock_visible", { visible: false, place: false });
    },
  };

  const usage = usageFor(settings.scope, ledger, agents, settings.weekStart);
  const block = ledger ? liveBlock(ledger.blocks, now) : undefined;

  // 趣味句换算要的数据：每次渲染都更新，抽的时候拿最新的
  const quipCtx = useRef<QuipContext | null>(null);
  quipCtx.current = usage && {
    lang,
    now,
    cost: usage.todayCost,
    days: usage.days,
    todayOutput: usage.todayOutput,
    hours: settings.scope === "claude" ? ledger?.hours : undefined,
    burnPerHour: block?.burnRate?.costPerHour,
  };
  const [quip, setQuip] = useState<Quip | null>(null);
  const nextQuip = useCallback(() => {
    if (quipCtx.current) setQuip(randomQuip(quipCtx.current));
  }, []);
  // 跨过里程碑时卡片上方冒的气泡
  const [bubble, setBubble] = useState<{ milestone: number; quip: Quip } | null>(null);
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const openRef = useRef(open);
  openRef.current = open;

  // 每次展开换一句；气泡还在时明细里已经是气泡那句，不换，气泡收起来
  useEffect(() => {
    if (!open) return;
    if (bubbleRef.current) setBubble(null);
    else nextQuip();
  }, [open, nextQuip]);
  // 换了语言，换一句对应语言的
  useEffect(() => {
    setQuip((q) => (q && quipCtx.current ? randomQuip(quipCtx.current) : q));
  }, [lang]);

  // 今天的花费跨过 5、10、20… 时冒气泡（展开着就直接换明细里那句）。
  // 刚打开程序、换了统计范围、过了零点时只记下当时的数，不冒
  const last = useRef<{ key: string; cost: number } | null>(null);
  const todayCost = usage?.todayCost;
  const dayKey = `${settings.scope}|${dayIso(new Date(now))}`;
  useEffect(() => {
    if (todayCost === undefined) return;
    const prev = last.current;
    last.current = { key: dayKey, cost: todayCost };
    if (!prev || prev.key !== dayKey || !quipCtx.current) return;
    const milestone = crossedMilestone(prev.cost, todayCost);
    if (milestone === null) return;
    const q = randomQuip(quipCtx.current, true);
    setQuip(q);
    if (!openRef.current) setBubble({ milestone, quip: q });
  }, [todayCost, dayKey]);
  // 气泡停一会儿自己消失
  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(null), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [bubble]);

  const weekBudget =
    ledger && limits.sevenDay ? sevenDayBudget(limits.sevenDay, ledger.hours, ledger.nonSubscription) : null;
  const view: ViewProps = {
    scope: settings.scope,
    scopeName: scopeLabel(settings.scope, t),
    usage,
    block,
    limits,
    weekBudget: weekBudget?.budget ?? null,
    // 5h 窗口里订阅花的：剔除认出来的非订阅会话
    blockUsed: block ? subscriptionSpent(block.costUSD, ledger?.nonSubscription, Date.parse(block.startTime)).spent : 0,
    speed,
    quip,
    nextQuip,
    hourly: settings.scope === "claude" && ledger ? hourBuckets(ledger.hours, "today").map((b) => b.cost) : null,
    now,
    version,
    hasNew: !!latest && !!version && newer(latest, version),
    actions,
    open,
    hot,
    detailsRef,
    rowRef,
    quipRef,
  };

  // 在卡片上任意位置按住都能拖动（按钮除外）。不用系统拖动（原因见 shell.rs 的 DockDrag）：
  // 按下时让 Rust 端记住窗口和鼠标的位置，之后鼠标一动就让它按系统的鼠标位置挪窗口
  const drag = useRef<{ frame: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { frame: 0 };
    void invoke("dock_drag_start");
  };
  const onPointerMove = () => {
    const d = drag.current;
    // 一帧只挪一次，鼠标事件再多也不会挤一堆调用
    if (!d || d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      void invoke("dock_drag_move");
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className={`${styles.stage} ${dir === "down" ? styles.down : ""}`}
      // 往上展开时卡片贴着底边：收起时底下空出趣味句那块地方，展开时这块空白和趣味句一起变化（同样的过渡），那一行就不动
      style={{ paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM + (dir === "up" && !open ? sizes.quip : 0) }}
    >
      <div
        className={styles.anchor}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <PaperDock {...view} />
        {bubble && !open && <Bubble milestone={bubble.milestone} quip={bubble.quip} />}
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className={styles.iconBtn} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

const OPEN_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M9.5 2.5h4v4" />
    <path d="M13.5 2.5L8 8" />
    <path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </svg>
);

const HIDE_ICON = (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M2 2l8 8M10 2l-8 8" />
  </svg>
);

/** 剩余时间写成 4:18 */
function hm(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** 限额百分比写成 23% */
function pct(w: { usedPercentage: number }): string {
  return `${Math.round(w.usedPercentage)}%`;
}

/** 展开时明细一条条依次出来：给第 i 条标上序号，CSS 按它往后推迟 */
function stagger(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

// ---------- 卡片（亮暗跟主题） ----------

function PaperDock(props: ViewProps) {
  const { open, hot, detailsRef, rowRef, quipRef, usage, quip, nextQuip } = props;
  return (
    <div className={`${styles.card} ${open ? styles.open : ""} ${hot ? styles.hot : ""} tnum`}>
      {/* 明细在上面、趣味句在下面，展开时上下一起长，平时那一行一直待在原地（往下展开时顺序见 CSS 的 .down） */}
      <div className={styles.fold}>
        <div className={styles.foldInner}>
          <div ref={detailsRef}>
            <PaperDetails {...props} />
          </div>
        </div>
      </div>
      <div ref={rowRef} className={styles.rowWrap}>
        <PaperRow {...props} />
      </div>
      <div className={`${styles.fold} ${styles.quipFold}`}>
        <div className={styles.foldInner}>
          {/* 还没有数据时里面是空的，高度为 0，下面就不展开 */}
          <div ref={quipRef}>{usage && <QuipLine quip={quip} onNext={nextQuip} />}</div>
        </div>
      </div>
    </div>
  );
}

/** 平时看到的那一行：左边今日费用；右边对称地放官方 5h 限额（标签后面是离重置还有多久），读不到限额时放本月费用 */
function PaperRow({ scope, scopeName, usage, block, limits, speed, now }: ViewProps) {
  const { t } = useI18n();
  const level = block?.burnRate ? burnLevel(block.burnRate.tokensPerMinuteForIndicator) : null;
  const five = limits.fiveHour;
  return (
    <div className={styles.row}>
      <div className={styles.today}>
        <span className={styles.caption}>
          {level && <span className={styles.dot} style={{ background: BURN_COLOR[level] }} />}
          {/* 右边还有百分比和生成速度，地方小："全部 Agent"简写成"全部"（展开后的标题里是全称） */}
          {scope === "claude"
            ? t("dock.today")
            : `${t("dock.today")} · ${scope === "all" ? t("dock.all") : scopeName}`}
        </span>
        <span className={styles.amount}>{usage ? <AnimatedNumber value={usage.todayCost} format={money} /> : "—"}</span>
      </div>
      {five ? (
        <div className={styles.side}>
          <span className={styles.caption}>
            {t("limits.fiveHour")}
            {/* 过了重置时间、新数据还没到：写"已重置"（百分比按 0） */}
            <span className={styles.captionSoft}>{five.reset ? t("limits.reset") : hm(minutesLeft(five, now))}</span>
          </span>
          <span className={styles.sideLine}>
            <span className={`${styles.sideAmount} ${five.usedPercentage >= 100 ? styles.over : ""}`}>
              <AnimatedNumber value={five.usedPercentage} format={(v) => `${Math.round(v)}%`} />
            </span>
            {/* 生成速度接在百分比后面（最近一条回复） */}
            {speed && (
              <span className={styles.sideSpeed}>
                <AnimatedNumber value={speed.last} format={tokPerSecValue} /> tok/s
              </span>
            )}
          </span>
        </div>
      ) : (
        usage && (
          <div className={styles.side}>
            <span className={styles.caption}>{t("dock.month")}</span>
            <span className={styles.sideAmount}>{money(usage.monthCost)}</span>
          </div>
        )
      )}
    </div>
  );
}

/** 今天 24 小时的迷你柱子：现在这个小时用强调色，还没到的小时只画底。i 是它在明细里排第几条 */
function Hourly({ costs, now, i }: { costs: number[]; now: number; i: number }) {
  const { t } = useI18n();
  const max = Math.max(...costs, 0.01);
  const hour = new Date(now).getHours();
  return (
    <div className={`${styles.hourly} ${styles.rise}`} style={stagger(i)} role="img" aria-label={t("dock.hourly")}>
      {costs.map((cost, h) => (
        <span
          key={h}
          className={h === hour ? styles.hourNow : h > hour ? styles.hourLater : undefined}
          style={{ height: `${Math.max(h > hour ? 0 : 6, (cost / max) * 100)}%`, animationDelay: `${100 + h * 12}ms` }}
        />
      ))}
    </div>
  );
}

/** 一句趣味话：左边表情，右边正文 + 冷知识 */
/** 数字和后面的单位、词之间换成不断行的空格（7.6 本、1.33 token、2017 年），换行时不会把它们拆开 */
function keepNumbers(text: string): string {
  return text.replace(/(\d) (?=\S)/g, "$1 ");
}

/** 一句趣味话的 key：换一句时 key 变了，重新播一遍进场动画 */
function quipKey(quip: Quip): string {
  return `${quip.id}|${quip.text}`;
}

/** 一句趣味话：左边表情，右边正文 + 冷知识 */
function QuipBody({ quip }: { quip: Quip }) {
  return (
    <span className={styles.quipIn}>
      <span className={styles.quipEmoji} aria-hidden="true">
        {quip.emoji}
      </span>
      <span className={styles.quipBody}>
        <span className={`${styles.quipText} ${quip.rare ? styles.quipRare : ""}`}>{keepNumbers(quip.text)}</span>
        {quip.fact && <span className={styles.quipFact}>{keepNumbers(quip.fact)}</span>}
      </span>
    </span>
  );
}

/** 卡片下面那句趣味话，整块点一下换一句。高度固定（两行正文 + 两行冷知识），换句子时窗口不用跟着改大小 */
function QuipLine({ quip, onNext }: { quip: Quip | null; onNext: () => void }) {
  return (
    <button className={styles.quip} onClick={onNext}>
      {/* 展开时浮现放在里层，按钮自己的悬停底色不和它抢 transition */}
      <span className={styles.rise} style={stagger(1)}>
        {quip && <QuipBody key={quipKey(quip)} quip={quip} />}
      </span>
    </button>
  );
}

/** 跨过里程碑时卡片外面冒的气泡：破 $100 了 + 一句趣味话。不接收鼠标，过一会儿自己淡掉 */
function Bubble({ milestone, quip }: { milestone: number; quip: Quip }) {
  const { t } = useI18n();
  return (
    <div className={`${styles.bubble} tnum`} role="status">
      <span className={styles.bubbleHead}>{t("dock.milestone", { amount: `$${milestone.toLocaleString("en-US")}` })}</span>
      <QuipBody key={quipKey(quip)} quip={quip} />
    </div>
  );
}

/** 明细列表里的一行：名字 + 数。i 是第几条 */
function Pair({ i, name, className, children }: { i: number; name: string; className?: string; children: ReactNode }) {
  return (
    <>
      <dt className={styles.rise} style={stagger(i)}>
        {name}
      </dt>
      <dd className={`${styles.rise} ${className ?? ""}`} style={stagger(i)}>
        {children}
      </dd>
    </>
  );
}

/** 展开后多出来的明细 */
function PaperDetails({
  scopeName,
  usage,
  block,
  limits,
  weekBudget,
  blockUsed,
  speed,
  hourly,
  now,
  version,
  hasNew,
  actions,
}: ViewProps) {
  const { t } = useI18n();
  const level = block?.burnRate ? burnLevel(block.burnRate.tokensPerMinuteForIndicator) : null;
  const { fiveHour, sevenDay } = limits;
  // 从上往下数第几条，展开时按这个顺序一条条出来（有的行没有，所以边画边数）
  let i = 0;
  return (
    <div className={styles.details}>
      <div className={`${styles.head} ${styles.rise}`} style={stagger(i++)}>
        <span className={styles.scope}>{scopeName}</span>
        <span className={styles.spacer} />
        <IconButton label={t("dock.open")} onClick={() => actions.open()}>
          {OPEN_ICON}
        </IconButton>
        <IconButton label={t("dock.hide")} onClick={actions.hide}>
          {HIDE_ICON}
        </IconButton>
      </div>

      {hourly && <Hourly costs={hourly} now={now} i={i++} />}

      {usage ? (
        <dl className={styles.list}>
          <Pair i={i++} name={t("dock.week")}>
            {money(usage.weekCost)}
          </Pair>
          <Pair i={i++} name={t("dock.tokens")}>
            {tokens(usage.todayTokens)}
          </Pair>
          {fiveHour && (
            <Pair i={i++} name={t("limits.fiveHour")} className={fiveHour.usedPercentage >= 100 ? styles.over : undefined}>
              {pct(fiveHour)}
            </Pair>
          )}
          {sevenDay && (
            <Pair i={i++} name={t("limits.sevenDay")} className={sevenDay.usedPercentage >= 100 ? styles.over : undefined}>
              {pct(sevenDay)}
              {/* 整个 7 天额度大约值多少美元（见 sevenDayBudget），淡一点跟在后面 */}
              {weekBudget !== null && (
                <span className={styles.ddSoft}>
                  {t("limits.budgetShort", { budget: `$${Math.round(weekBudget).toLocaleString("en-US")}` })}
                </span>
              )}
            </Pair>
          )}
          {/* 生成速度平时显示在收起那一行的百分比后面；读不到限额（没有百分比）时才放在这里 */}
          {speed && !fiveHour && (
            <Pair i={i++} name={t("speed.title")}>
              {tokPerSec(speed.last)}
            </Pair>
          )}
          {fiveHour && (
            <Pair i={i++} name={t("dock.left")}>
              {fiveHour.reset ? t("limits.reset") : duration(minutesLeft(fiveHour, now))}
            </Pair>
          )}
          {block && (
            <>
              <Pair i={i++} name={t("dock.blockUsed")}>
                {money(blockUsed)}
              </Pair>
              <Pair i={i++} name={t("block.burn")}>
                {level && <span className={styles.dot} style={{ background: BURN_COLOR[level] }} />}
                {block.burnRate ? `${money(block.burnRate.costPerHour)}/h` : "—"}
              </Pair>
            </>
          )}
        </dl>
      ) : (
        <div className={`${styles.empty} ${styles.rise}`} style={stagger(i++)}>
          {t("dock.noData")}
        </div>
      )}

      {/* 这个块里真的碰到过 Anthropic 的用量上限：ccusage 从日志里读到了重置时间 */}
      {block?.usageLimitResetTime && (
        <div className={`${styles.limitHit} ${styles.rise}`} style={stagger(i++)}>
          {t("blocks.limitHit", { time: clock(block.usageLimitResetTime) })}
        </div>
      )}

      <div className={`${styles.foot} ${styles.rise}`} style={stagger(i++)}>
        <span>{usage ? updatedAgo(t, usage.fetchedAt, now) : ""}</span>
        <span className={styles.spacer} />
        {hasNew ? (
          <button className={styles.update} onClick={() => actions.open("settings")}>
            <span className={styles.dot} />
            {t("dock.update")}
          </button>
        ) : (
          version && <span className={styles.mono}>ccusage {version}</span>
        )}
      </div>
    </div>
  );
}
