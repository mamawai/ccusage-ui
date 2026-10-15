// 数字变化时从旧值滚到新值，而不是直接跳
import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  format: (value: number) => string;
  /** 毫秒 */
  duration?: number;
}

export function AnimatedNumber({ value, format, duration = 700 }: Props) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    // 系统里关了动画就直接显示
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // 先快后慢
      const eased = 1 - Math.pow(1 - p, 3);
      const current = begin + (value - begin) * eased;
      from.current = current;
      setShown(current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <>{format(shown)}</>;
}
