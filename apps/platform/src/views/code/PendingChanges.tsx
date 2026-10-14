import { Button, Input } from "@/components/ui";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Card } from "@/components/Card/Card";
import type { ChangeKind } from "./useDraft";
import styles from "./code.module.css";

const GLYPH: Record<ChangeKind, string> = { added: "+", modified: "●", deleted: "−" };

export interface PendingChangesProps {
  pending: { path: string; kind: ChangeKind }[];
  existing: ReadonlySet<string>;
  /** Why new files cannot be drafted here (fixture app repo, non-head revision), or null. */
  editBlocked: string | null;
  hrefFor(path: string): string;
  commitHref: string;
  onDiscard(path: string): void;
  onNewFile(path: string): void;
}

/** Validates a new file path; returns the problem or null. */
export function newPathProblem(path: string, existing: ReadonlySet<string>): string | null {
  if (!path) return "Enter a path.";
  if (path.startsWith("/") || path.endsWith("/")) return "Use a repo-relative file path, without a leading or trailing slash.";
  if (path.split("/").some((p) => p === "" || p === "." || p === "..")) return "The path has an empty, . or .. segment.";
  if (existing.has(path)) return `${path} already exists.`;
  return null;
}

/** The draft's added, modified and deleted files, New file…, and the page's primary action: Commit…. */
export function PendingChanges({ pending, existing, editBlocked, hrefFor, commitHref, onDiscard, onNewFile }: PendingChangesProps) {
  const uid = useId();
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = path.trim();
    const issue = newPathProblem(p, existing);
    setProblem(issue);
    if (issue) return;
    onNewFile(p);
    setPath("");
    setAdding(false);
  };

  return (
    <Card
      title={`Pending changes${pending.length ? ` (${pending.length})` : ""}`}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => setAdding((a) => !a)} disabled={!!editBlocked} aria-expanded={adding}>
            New file…
          </Button>
          {pending.length ? (
            <Button asChild variant="primary"><Link to={commitHref}>Commit…</Link></Button>
          ) : (
            <Button type="button" variant="primary" disabled title="No pending changes.">Commit…</Button>
          )}
        </>
      }
    >
      {adding && (
        <form onSubmit={submit} className={styles.inlineForm}>
          <label htmlFor={`${uid}-p`}>New file path</label>
          <Input id={`${uid}-p`} value={path} onChange={(e) => setPath(e.target.value)} placeholder="e.g. src/notes.md" autoComplete="off" aria-describedby={problem ? `${uid}-e` : undefined} />
          <Button type="submit" variant="secondary">Add</Button>
          {problem && <span id={`${uid}-e`} role="alert" className={styles.error}>{problem}</span>}
        </form>
      )}
      {pending.length ? (
        <ul className={styles.pendingList} aria-label="Pending files">
          {pending.map((c) => (
            <li key={c.path} className={styles.pendingRow} data-change={c.kind}>
              <span aria-hidden="true" className={styles.glyph}>{GLYPH[c.kind]}</span>
              <Link to={hrefFor(c.path)} className="u-marker"><code>{c.path}</code></Link>
              <span className={styles.muted}>{c.kind}</span>
              <Button type="button" variant="secondary" onClick={() => onDiscard(c.path)} aria-label={`Discard ${c.path}`}>Discard</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No pending changes. Edit a file to start a draft.</p>
      )}
    </Card>
  );
}
