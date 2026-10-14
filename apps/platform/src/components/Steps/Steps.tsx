import type { ReactNode } from "react";
import { Button } from "../ui/Controls";
import styles from "./Steps.module.css";

export interface Step {
  id: string;
  title: string;
  state: "done" | "current" | "todo";
  /** One-line summary shown for a done step ("system.peopling created"). */
  summary?: ReactNode;
  /** Shows "Edit" on a done step. */
  onEdit?: () => void;
}

/**
 * A real sequence (Start only): numbered steps. The current step expands with `children` as its body (one primary);
 * done steps collapse to a summary; todo steps show their title only.
 */
export function Steps({ steps, label = "Steps", children }: { steps: Step[]; label?: string; children?: ReactNode }) {
  return (
    <ol className={styles.steps} aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.id} className={styles.step} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
          <span className={`u-numeric ${styles.marker}`} aria-hidden="true">{i + 1}</span>
          <div className={styles.body}>
            <div className={styles.head}>
              <span className={styles.title}>{s.title}</span>
              <span className="sr-only">{s.state === "done" ? ", done" : s.state === "current" ? ", current step" : ", not started"}</span>
              {s.state === "done" && s.summary && <span className={styles.summary}><span className="u-glyph" aria-hidden="true">✓</span> {s.summary}</span>}
              {s.state === "done" && s.onEdit && <Button variant="ghost" size="compact" onClick={s.onEdit} aria-label={`Edit ${s.title}`}>Edit</Button>}
            </div>
            {s.state === "current" && children && <div className={styles.content}>{children}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
