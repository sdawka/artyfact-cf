import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

/**
 * Plain statement of absence plus an optional next action. Never coloured as success.
 * `live` makes it a polite status region (only for states that appear after user action).
 */
export function EmptyState({ title, children, action, live = false }: { title: string; children?: ReactNode; action?: ReactNode; live?: boolean }) {
  return (
    <div className={styles.empty} {...(live && { role: "status" })}>
      <p className={styles.title}>{title}</p>
      {children && <div className={styles.body}>{children}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
