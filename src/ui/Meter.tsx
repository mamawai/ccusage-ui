// 细进度条：出现时从左往右长出来，数值变化时平滑过渡
import styles from "./Meter.module.css";

interface Props {
  /** 0～1，超出会被截住 */
  ratio: number;
  color?: string;
  /** 像素 */
  height?: number;
  label?: string;
}

export function Meter({ ratio, color = "var(--ink)", height = 6, label }: Props) {
  const width = `${Math.min(1, Math.max(0, ratio)) * 100}%`;
  return (
    <div
      className={styles.track}
      style={{ height }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className={styles.fill} style={{ width, background: color }} />
    </div>
  );
}
