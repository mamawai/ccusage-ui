// 生成速度（tok/s）：和 claude-hud 一样，一条回复的输出 token ÷ 这条回复的 API 时间，数据来自 Claude Code 给状态栏的数据。
// 由状态栏入口记下（Rust 端 speed.rs），这里读近 1 小时的；这段时间没有回复就当没有，不显示
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { STATUSLINE_CHANGED } from "./limits";

export interface Speed {
  /** 最近一条回复的速度 */
  last: number;
  /** 近 1 小时所有回复合起来的平均速度 */
  avg: number;
}

/** 有新回复时马上更新；另外每分钟重读一次，"近 1 小时"会往前走 */
export function useSpeed(): Speed | null {
  const [speed, setSpeed] = useState<Speed | null>(null);
  useEffect(() => {
    const read = () => void invoke<Speed | null>("speed_read").then(setSpeed);
    read();
    const stop = listen(STATUSLINE_CHANGED, read);
    const every = window.setInterval(read, 60_000);
    return () => {
      stop.then((f) => f());
      window.clearInterval(every);
    };
  }, []);
  return speed;
}

/** 速度的数字部分：128 */
export function tokPerSecValue(v: number): string {
  return String(Math.round(v));
}

/** 速度写成 128 tok/s */
export function tokPerSec(v: number): string {
  return `${tokPerSecValue(v)} tok/s`;
}
