// 开关：点一下滑块滑到另一边
import styles from "./Switch.module.css";

interface Props {
  /** 给读屏用的名字 */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: Props) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={styles.track} onClick={() => onChange(!checked)}>
      <span className={styles.knob} />
    </button>
  );
}
