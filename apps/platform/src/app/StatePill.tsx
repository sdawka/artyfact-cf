import type { ReactNode } from "react";
import styles from "./StatePill.module.css";

export type RevisionState = "canonical" | "candidate" | "deployed" | "fixture";

/** Small bordered tag naming what the user is looking at. Square-ish corners; never a pill shape or a fill. */
export function StatePill({ state, children, title }: { state: RevisionState; children?: ReactNode; title?: string }) {
  return (
    <span className={styles.pill} data-state={state} title={title}>
      {children ?? state}
    </span>
  );
}
