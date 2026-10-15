// npm 上 ccusage 的最新版本：存在 localStorage，大 Dock、小 Dock 都读写
// （小 Dock 页脚显示"可更新"，大 Dock 状态栏、设置页也显示）
import { useCallback, useEffect, useState } from "react";
import { latestVersion } from "./api";

const LATEST_KEY = "ccusage-ui.latest.v1";
/** npm 最新版本多久查一次 */
const LATEST_MAX_AGE_MS = 6 * 3600_000;

export interface Latest {
  version: string;
  checkedAt: number;
}

/** 大 Dock 里"npm 最新版本"的状态：查的时候 checking，查不到有 error，查到过就有 version */
export interface LatestState {
  checking: boolean;
  version?: string;
  error?: unknown;
}

function read<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const readLatest = () => read<Latest>(LATEST_KEY);

/** 查 npm 上的最新版本并存下来；force 为 false 时，6 小时内查过就直接用上次的结果 */
export async function checkLatest(force: boolean): Promise<Latest> {
  const cached = readLatest();
  if (!force && cached && Date.now() - cached.checkedAt < LATEST_MAX_AGE_MS) return cached;
  const latest = { version: await latestVersion(), checkedAt: Date.now() };
  localStorage.setItem(LATEST_KEY, JSON.stringify(latest));
  return latest;
}

/**
 * 找到 ccusage 以后查一次 npm 最新版本，之后每 6 小时查一次；check(true) 是"检查更新"按钮。
 * 大 Dock、小 Dock 都用（大 Dock 收到托盘时会整个关掉，靠小 Dock 定时查）；另一个窗口查到的也跟着变
 */
export function useLatest(enabled: boolean) {
  const [state, setState] = useState<LatestState>(() => ({ checking: false, version: readLatest()?.version }));

  const check = useCallback((force: boolean) => {
    setState((s) => ({ ...s, checking: true, error: undefined }));
    checkLatest(force)
      .then((latest) => setState({ checking: false, version: latest.version }))
      .catch((error) => setState((s) => ({ checking: false, version: s.version, error })));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    check(false);
    const every = window.setInterval(() => check(false), LATEST_MAX_AGE_MS);
    return () => window.clearInterval(every);
  }, [enabled, check]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const latest = readLatest();
      if (e.key === LATEST_KEY && latest) setState((s) => ({ ...s, version: latest.version }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { latest: state, check };
}

/** 版本号比大小：a 比 b 新返回 true（按点和横线拆开逐段比数字） */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
