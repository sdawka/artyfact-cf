import type { ConflictReport } from "../../../shared/api";
import { conflictSubjects } from "./lib";
import styles from "./work.module.css";

const GLYPH: Record<ConflictReport["kind"], string> = { file: "§", "soft-semantic": "≈", "hard-semantic": "⊥", evidence: "◇" };

/** Typed conflict chips: file | soft-semantic | hard-semantic | evidence. Hard ones use the danger tone. */
export function ConflictChips({ conflicts }: { conflicts: readonly ConflictReport[] }) {
  if (!conflicts.length) return null;
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
