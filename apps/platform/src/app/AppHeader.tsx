import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./AppHeader.module.css";

/** Presentational header shared by Home, Part details and System workspaces. */
export function AppHeader({ navigation, context, status, actions }: {
  navigation?: ReactNode; context?: ReactNode; status?: ReactNode; actions: ReactNode;
}) {
  return <header className={styles.header} data-app-header>
    <div className={styles.brand}>{navigation}<Link to="/" className={`wordmark ${styles.wordmark}`} title="Home: all Systems">artyfact</Link></div>
    {context && <div className={styles.context}>{context}</div>}
    {status && <div className={styles.status} aria-label="Workspace status">{status}</div>}
    <div className={styles.actions}>{actions}</div>
  </header>;
}
