import { Button, Input } from "@/components/ui";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { ChangeKind } from "./useDraft";
import styles from "./code.module.css";

const GLYPH: Record<ChangeKind, string> = { added: "+", modified: "~", deleted: "−" };

/** Validates a new file path; returns the problem or null. */
export function newPathProblem(path: string, existing: ReadonlySet<string>): string | null {
  if (!path) return "Enter a path.";
  if (path.startsWith("/") || path.endsWith("/")) return "Use a repo-relative file path, without a leading or trailing slash.";
  if (path.split("/").some((p) => p === "" || p === "." || p === "..")) return "The path has an empty, . or .. segment.";
  if (existing.has(path)) return `${path} already exists.`;
  return null;
}

/** The inline form behind the header's "New file". */
export function NewFileForm({ existing, onAdd, onCancel }: { existing: ReadonlySet<string>; onAdd(path: string): void; onCancel(): void }) {
  const uid = useId();
  const [path, setPath] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = path.trim();
    const issue = newPathProblem(p, existing);
    setProblem(issue);
    if (!issue) onAdd(p);
  };
  return (
    <form onSubmit={submit} className={styles.inlineForm}>
      <label htmlFor={`${uid}-p`}>New file path</label>
      <Input id={`${uid}-p`} value={path} onChange={(e) => setPath(e.target.value)} placeholder="e.g. src/notes.md" autoComplete="off" autoFocus aria-describedby={problem ? `${uid}-e` : undefined} />
      <Button type="submit" variant="secondary">Add</Button>
      <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      {problem && <span id={`${uid}-e`} role="alert" className={styles.error}>{problem}</span>}
    </form>
  );
}

export interface PendingWellProps {
  pending: { path: string; kind: ChangeKind }[];
  hrefFor(path: string): string;
  onDiscard(path: string): void;
}

/** The draft's files as one well above the workbench. Rendered only when something is pending. */
export function PendingWell({ pending, hrefFor, onDiscard }: PendingWellProps) {
  if (!pending.length) return null;
  return (
    <section className={styles.pendingWell} aria-label="Pending changes">
      <p className={styles.pendingCount}>{pending.length} pending</p>
      <ul className={styles.pendingList} aria-label="Pending files">
        {pending.map((c) => (
          <li key={c.path} className={styles.pendingRow} data-change={c.kind}>
            <span aria-hidden="true" className={`u-glyph ${styles.glyph}`}>{GLYPH[c.kind]}</span>
            <Link to={hrefFor(c.path)} className={styles.pendingLink}><code>{c.path}</code></Link>
            <span className={styles.muted}>{c.kind}</span>
            <Button type="button" variant="ghost" size="compact" onClick={() => onDiscard(c.path)} aria-label={`Discard ${c.path}`}>Discard</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
