import type { TaskConflict } from "../../../../shared/lifecycle";
import type { TaskConflictRow } from "./lib";
import styles from "../ConflictChips.module.css";

const GLYPH: Record<TaskConflict["kind"], string> = { dependency: "→", source: "§", ontology: "⊥", unknown: "?" };

/**
 * A task's conflicts with other tasks of its plan: source | ontology | unknown, each naming the other task in visible text.
 * Dependencies already show as "waits on" / "after", so they are not repeated here. The waves keep conflicting tasks
 * apart, so no chip uses the danger tone.
 */
export function TaskConflictChips({ conflicts }: { conflicts: readonly TaskConflictRow[] }) {
  const shown = conflicts.filter((c) => c.kind !== "dependency");
  if (!shown.length) return null;
  return (
    <ul className={styles.conflicts} aria-label="Conflicts">
      {shown.map((c, i) => (
        <li key={`${c.kind}-${c.with}-${i}`} className={styles.conflict} data-kind={c.kind} data-tone="neutral" title={[c.message, c.subjects.length ? `On: ${c.subjects.join(", ")}` : ""].filter(Boolean).join(" · ") || undefined}>
          <span aria-hidden="true" className="u-glyph">{GLYPH[c.kind]}</span> {c.kind} with {c.with}
          {c.subjects.length > 0 && <span className={styles.more}> on {c.subjects.length} {c.subjects.length === 1 ? "path" : "paths"}</span>}
        </li>
      ))}
    </ul>
  );
}
