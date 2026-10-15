// 白底面板：标题栏 + 内容。出现时从下面浮上来一点
import type { CSSProperties, ReactNode } from "react";
import styles from "./Panel.module.css";

interface Props {
  title: string;
  sub?: string;
  /** 标题栏右边放的控件 */
  actions?: ReactNode;
  /** 出场动画的延迟（毫秒），几块面板错开出现 */
  delay?: number;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, sub, actions, delay = 0, className, children }: Props) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  return (
    <section className={`${styles.panel} ${className ?? ""}`} style={style}>
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {sub && <span className={styles.sub}>{sub}</span>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </section>
  );
}
