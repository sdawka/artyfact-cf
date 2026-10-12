import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

/** Plain statement of absence plus an optional next action. Never coloured as success. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty} role="status">
      <p className={styles.title}>{title}</p>
      {children && <div className={styles.body}>{children}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
