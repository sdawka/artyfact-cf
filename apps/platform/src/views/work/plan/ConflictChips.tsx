import type { TaskConflict } from "../../../../shared/lifecycle";
import type { TaskConflictRow } from "./lib";
import workStyles from "../work.module.css";

const GLYPH: Record<TaskConflict["kind"], string> = { dependency: "→", source: "§", ontology: "⊥", unknown: "?" };

/**
 * A task's conflicts with other tasks of its plan: dependency | source | ontology | unknown, each naming the other task.
 * The waves already keep conflicting tasks apart, so no chip uses the danger tone.
 */
export function TaskConflictChips({ conflicts }: { conflicts: readonly TaskConflictRow[] }) {
  if (!conflicts.length) return null;
  return (
    <ul className={workStyles.conflicts} aria-label="Conflicts">
      {conflicts.map((c, i) => (
        <li key={`${c.kind}-${c.with}-${i}`} className={workStyles.conflict} data-kind={c.kind} title={[c.message, c.subjects.length ? `On: ${c.subjects.join(", ")}` : ""].filter(Boolean).join(" · ")}>
          <span aria-hidden="true">{GLYPH[c.kind]}</span> {c.kind} · {c.with}
          {c.subjects.length > 0 && <span className={workStyles.muted}> ×{c.subjects.length}</span>}
        </li>
      ))}
    </ul>
  );
}
