// 分段选择：选中的那块会滑到被点的选项上，而不是直接跳过去
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./Segmented.module.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  /** 给读屏用的名字 */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const index = options.findIndex((o) => o.value === value);

  // 量出选中按钮的位置；文字变了（切语言、字体加载完）宽度会变，所以也要跟着量
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const measure = () => {
      const button = group.children[index + 1] as HTMLElement | undefined;
      if (!button) return setThumb(null);
      const next = { left: button.offsetLeft, width: button.offsetWidth };
      // 位置没变就不更新，免得父组件每次重渲染都多渲染一遍
      setThumb((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [index, options]);

  return (
    <div ref={groupRef} role="group" aria-label={label} className={styles.group}>
      <span
        className={styles.thumb}
        style={thumb ? { transform: `translateX(${thumb.left}px)`, width: thumb.width } : { opacity: 0 }}
        aria-hidden="true"
      />
      {options.map((o) => (
        <button
          key={o.value}
          className={styles.option}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
