import { useEffect, useRef, type ReactNode } from "react";
import styles from "./decision.module.css";

export interface DecisionHeadProps {
  /** The open decision's title (the Evolution's, "Promote {Evolution}", the Task's): the detail pane's h2. */
  title: ReactNode;
  /** One status for the whole decision (the verdict summary, a state chip). */
  status?: ReactNode;
  /** A MetaLine about the decision. */
  meta?: ReactNode;
  secondary?: ReactNode;
  /** The decision's one primary (Promote, Accept). */
  primary?: ReactNode;
  /** Move focus to the h2 when the decision opens (not when Review opened it by itself). */
  autoFocus?: boolean;
  children?: ReactNode;
}

/** The head of a decision in Review's detail pane: h2 and status on one line, the meta line, then the actions in one row. */
export function DecisionHead({ title, status, meta, secondary, primary, autoFocus = false, children }: DecisionHeadProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <header className={styles.head}>
      <div className={styles.titleRow}>
        <h2 ref={ref} tabIndex={-1} className={styles.title}>{title}</h2>
        {status}
      </div>
      {meta}
      {(secondary || primary) && <div className={styles.actions}>{primary}{secondary}</div>}
      {children}
    </header>
  );
}
