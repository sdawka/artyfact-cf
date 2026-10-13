import type { ConflictReport } from "../../../shared/api";
import { conflictSubjects } from "./lib";
import styles from "./work.module.css";

/** A conflict as the chips show it: a candidate conflict, or a task conflict (`declared` = a dependsOn edge) via plan/lib `conflictReports`. */
export type ChipConflict = Omit<ConflictReport, "kind"> & {
  kind: ConflictReport["kind"] | "declared";
  /** Visible name of the other side (a task title); candidate conflicts name theirs in the tooltip only. */
  with?: string;
};

const GLYPH: Record<ChipConflict["kind"], string> = { declared: "→", file: "§", "soft-semantic": "≈", "hard-semantic": "⊥", evidence: "◇" };

/**
 * Typed conflict chips: declared | file | soft-semantic | hard-semantic | evidence. Hard ones use the danger tone. `compact` shows
 * one chip per kind with the number of conflicts of that kind (the Review queue), instead of one chip per conflict.
 */
export function ConflictChips({ conflicts, compact = false }: { conflicts: readonly ChipConflict[]; compact?: boolean }) {
  if (!conflicts.length) return null;
  if (compact) {
    const kinds = (Object.keys(GLYPH) as ChipConflict["kind"][]).map((k) => [k, conflicts.filter((c) => c.kind === k)] as const).filter(([, xs]) => xs.length);
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
        const subjects = conflictSubjects(c as ConflictReport);
        const title = [c.message, subjects.length ? `On: ${subjects.join(", ")}` : "", `With: ${(c.candidates ?? []).join(", ")}`].filter(Boolean).join(" · ");
        return (
          <li key={`${c.kind}-${i}`} className={styles.conflict} data-kind={c.kind} title={title}>
            <span aria-hidden="true">{GLYPH[c.kind]}</span> {c.kind}
            {c.with && <> with {c.with}</>}
            {subjects.length > 0 && <span className={styles.muted}> ×{subjects.length}</span>}
          </li>
        );
      })}
    </ul>
  );
}
