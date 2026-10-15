import type { ConflictReport } from "../../../shared/api";
import { conflictSubjects } from "./lib";
import styles from "./ConflictChips.module.css";

const GLYPH: Record<ConflictReport["kind"], string> = { file: "§", "soft-semantic": "≈", "hard-semantic": "⊥", evidence: "◇" };

/** Only a hard-semantic conflict is danger; file and soft overlaps wait on a person (attention); evidence is neutral. */
export const conflictTone = (kind: ConflictReport["kind"]) =>
  kind === "hard-semantic" ? "fail" : kind === "evidence" ? "neutral" : "attention";

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 paths", "1 node and 3 paths". */
function onWhat(c: ConflictReport): string {
  const nodes = c.nodes?.length ?? 0;
  const paths = c.paths?.length ?? 0;
  const parts = [nodes && count(nodes, "node"), paths && count(paths, "path")].filter(Boolean);
  if (!parts.length) {
    const n = conflictSubjects(c).length;
    return n ? count(n, "subject") : "";
  }
  return parts.join(" and ");
}

/**
 * Typed conflict chips: file | soft-semantic | hard-semantic | evidence. Each names the other party in visible text
 * ("with candidate.7.r2"), not only in a tooltip. `self` is the candidate the chips belong to (left out of "with").
 * `compact` shows one chip per kind with the number of conflicts of that kind (the Review queue).
 */
export function ConflictChips({ conflicts, compact = false, self }: { conflicts: readonly ConflictReport[]; compact?: boolean; self?: string }) {
  if (!conflicts.length) return null;
  if (compact) {
    const kinds = (Object.keys(GLYPH) as ConflictReport["kind"][]).map((k) => [k, conflicts.filter((c) => c.kind === k)] as const).filter(([, xs]) => xs.length);
    return (
      <ul className={styles.conflicts} aria-label="Conflicts">
        {kinds.map(([kind, xs]) => (
          <li key={kind} className={styles.conflict} data-kind={kind} data-tone={conflictTone(kind)} title={xs.map((c) => c.message).filter(Boolean).join(" · ")}>
            <span aria-hidden="true" className="u-glyph">{GLYPH[kind]}</span> {kind}
            {xs.length > 1 && <span className={styles.more}> · {xs.length} conflicts</span>}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={styles.conflicts} aria-label="Conflicts">
      {conflicts.map((c, i) => {
        const others = (c.candidates ?? []).filter((id) => id !== self);
        const on = onWhat(c);
        const subjects = conflictSubjects(c);
        const title = [c.message, subjects.length ? `On: ${subjects.join(", ")}` : ""].filter(Boolean).join(" · ");
        return (
          <li key={`${c.kind}-${i}`} className={styles.conflict} data-kind={c.kind} data-tone={conflictTone(c.kind)} title={title || undefined}>
            <span aria-hidden="true" className="u-glyph">{GLYPH[c.kind]}</span> {c.kind}
            {others.length > 0 && <> with <code>{others.join(", ")}</code></>}
            {on && <span className={styles.more}> on {on}</span>}
          </li>
        );
      })}
    </ul>
  );
}
