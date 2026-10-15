import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./AppHeader.module.css";

/**
 * Presentational header shared by Home, Part details and System workspaces. One row from 1024px (wordmark, selects, status,
 * actions pushed right); below that the selects take a second row.
 */
export function AppHeader({ navigation, context, status, actions, badge }: {
  navigation?: ReactNode; context?: ReactNode; status?: ReactNode; actions: ReactNode;
  /** Shown beside the wordmark (cat mode); its presence also notes the mode in the wordmark's title. */
  badge?: ReactNode;
}) {
  return <header className={styles.header} data-app-header>
    <div className={styles.brand}>{navigation}<Link to="/" className={`wordmark ${styles.wordmark}`} title={badge ? "Home: all Systems (cat mode)" : "Home: all Systems"}>artyfact</Link>{badge && <span className={styles.badge}>{badge}</span>}</div>
    {context && <div className={styles.context}>{context}</div>}
    {status && <div className={styles.status} aria-label="Workspace status">{status}</div>}
    <div className={styles.actions}>{actions}</div>
  </header>;
}
