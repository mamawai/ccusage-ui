// 安全网：里面的组件出错时，只在这一块显示出错和"重试"，不让整个窗口白屏
import { Component, type ReactNode } from "react";
import { useI18n } from "../i18n";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <Fallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function Fallback({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <div className={styles.box} role="alert">
      <span className={styles.text}>{t("error.section", { detail })}</span>
      <button className={styles.retry} onClick={onRetry}>
        {t("action.retry")}
      </button>
    </div>
  );
}
