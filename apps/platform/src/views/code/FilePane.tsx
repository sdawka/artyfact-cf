import { lazy, Suspense } from "react";
import { Link } from "react-router";
import type { FileScope } from "../../../shared/api";
import { ApiRequestError } from "@/api/client";
import { useFile } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useKeepParams } from "@/model/useSelection";
import { changeKind, type DraftApi } from "./useDraft";
import styles from "./code.module.css";

const CodeView = lazy(() => import("@/components/CodeView/CodeView"));

export interface FilePaneProps {
  repo: FileScope;
  path: string | null;
  draft: DraftApi;
  /** Why editing is off for this revision, or null when it is allowed. */
  editBlocked: string | null;
  editing: boolean;
  onEdit(): void;
  onStopEditing(): void;
}

const formatSize = (n: number | undefined) =>
  n === undefined ? "unknown" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** One file: path, size, mapped nodes, Edit / Discard / Delete, and the editor. Edits only touch the draft. */
export function FilePane({ repo, path, draft, editBlocked, editing, onEdit, onStopEditing }: FilePaneProps) {
  const drafted = path ? draft.draft.get(path) : undefined;
  const isNew = drafted?.base === null;
  const q = useFile({ repo, path: path && !isNew ? path : null });
  const href = useKeepParams();

  if (!path) return <section className={styles.pane} aria-label="File"><p className={styles.muted}>Select a file.</p></section>;

  const kind = changeKind(drafted);
  const file = q.data;
  const base = isNew ? null : (file?.text ?? null);
  const text = drafted ? drafted.content : base;
  const unreadable = !!file && (file.binary || file.truncated || file.text === null);
  const canEdit = !editBlocked && !unreadable && (isNew || !!file);
  const readOnly = !canEdit || !(editing || kind !== null);

  const discard = () => {
    draft.discard(path);
    onStopEditing();
  };

  return (
    <section className={styles.pane} aria-labelledby="file-pane-path">
      <div className={styles.paneHead}>
        <h2 id="file-pane-path" className={styles.path}><code>{path}</code></h2>
        <span className={styles.muted}>{isNew ? "new file" : formatSize(file?.size)}</span>
        {kind && <span className={styles.kind} data-change={kind}>{kind}</span>}
        <div className={styles.paneActions}>
          {canEdit && readOnly && kind !== "deleted" && (
            <button type="button" className={`u-brackets ${styles.btn}`} onClick={onEdit}>Edit</button>
          )}
          {kind && <button type="button" className={`u-brackets ${styles.btn}`} onClick={discard}>Discard</button>}
          {canEdit && kind !== "deleted" && (
            <button type="button" className={`u-brackets ${styles.btn}`} onClick={() => { draft.remove(path, base); onStopEditing(); }}>Delete file</button>
          )}
        </div>
      </div>
      {file?.nodes && file.nodes.length > 0 && (
        <ul className={styles.chips} aria-label="Model nodes in this file">
          {file.nodes.map((id) => (
            <li key={id} className={styles.nodeItem}>
              <NodeChip id={id} size="sm" />
              <Link className="u-marker" to={href("work", { panel: "intent", anchor: id })}>Describe a change<span className="sr-only"> ({id})</span></Link>
            </li>
          ))}
        </ul>
      )}
      {editBlocked && <p className={styles.muted}>{editBlocked}</p>}
      {q.isError && !isNew ? (
        <p role="alert" className={styles.error}>
          {q.error instanceof ApiRequestError && q.error.status === 404 ? `No file at ${path} in this revision.` : q.error.message}
        </p>
      ) : !isNew && q.isPending ? (
        <p className={styles.muted}>Loading {path}…</p>
      ) : kind === "deleted" ? (
        <p className={styles.muted}>Deleted in the draft. Discard to keep it.</p>
      ) : file?.binary ? (
        <p className={styles.muted}>Binary file, not shown.</p>
      ) : file?.truncated ? (
        <p className={styles.muted}>This file is too large to show in full; editing is off.</p>
      ) : (
        <Suspense fallback={<p className={styles.muted}>Loading editor…</p>}>
          <CodeView
            key={`${repo}:${path}`}
            value={text ?? ""}
            path={path}
            label={readOnly ? `${path} (read-only)` : path}
            readOnly={readOnly}
            onChange={(content) => draft.set(path, base, content)}
          />
        </Suspense>
      )}
    </section>
  );
}
