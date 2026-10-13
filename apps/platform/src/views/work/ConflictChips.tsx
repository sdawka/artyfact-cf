import type { ConflictReport } from "../../../shared/api";
import { conflictSubjects } from "./lib";
import styles from "./work.module.css";

const GLYPH: Record<ConflictReport["kind"], string> = { file: "§", "soft-semantic": "≈", "hard-semantic": "⊥", evidence: "◇" };

/**
 * Typed conflict chips: file | soft-semantic | hard-semantic | evidence. Hard ones use the danger tone. `compact` shows
 * one chip per kind with the number of conflicts of that kind (the Review queue), instead of one chip per conflict.
 */
export function ConflictChips({ conflicts, compact = false }: { conflicts: readonly ConflictReport[]; compact?: boolean }) {
  if (!conflicts.length) return null;
  if (compact) {
    const kinds = (Object.keys(GLYPH) as ConflictReport["kind"][]).map((k) => [k, conflicts.filter((c) => c.kind === k)] as const).filter(([, xs]) => xs.length);
    return (
      <ul className={styles.conflicts} aria-label="Conflicts">
        {kinds.map(([kind, xs]) => (
          <li key={kind} className={styles.conflict} data-kind={kind} title={xs.map((c) => c.message).filter(Boolean).join(" · ")}>
            <span aria-hidden="true">{GLYPH[kind]}</span> {kind}
            {xs.length > 1 && <span className={styles.muted}> · {xs.length} conflicts</span>}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={styles.conflicts} aria-label="Conflicts">
      {conflicts.map((c, i) => {
        const subjects = conflictSubjects(c);
        const title = [c.message, subjects.length ? `On: ${subjects.join(", ")}` : "", `With: ${(c.candidates ?? []).join(", ")}`].filter(Boolean).join(" · ");
        return (
          <li key={`${c.kind}-${i}`} className={styles.conflict} data-kind={c.kind} title={title}>
            <span aria-hidden="true">{GLYPH[c.kind]}</span> {c.kind}
            {subjects.length > 0 && <span className={styles.muted}> ×{subjects.length}</span>}
          </li>
        );
      })}
    </ul>
  );
}
