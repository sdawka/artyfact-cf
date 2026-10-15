import { Button, Menu } from "@/components/ui";
import { lazy, Suspense } from "react";
import { Link, useNavigate } from "react-router";
import type { FileScope } from "../../../shared/api";
import { ApiRequestError } from "@/api/client";
import { useFile } from "@/api/queries";
import { MetaLine } from "@/components/MetaLine/MetaLine";
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
  /** The revision being read, for the empty copy. */
  rev: string;
  /** Top-level directories of the repo, listed when no file is open (the App repo has no node mapping). */
  topLevel?: string[];
  onEdit(): void;
  onStopEditing(): void;
}

const formatSize = (n: number | undefined) =>
  n === undefined ? "unknown" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** One file: path, size, mapped nodes, Edit / Discard / Delete, and the editor. Edits only touch the draft. */
export function FilePane({ repo, path, draft, editBlocked, editing, rev, topLevel = [], onEdit, onStopEditing }: FilePaneProps) {
  const drafted = path ? draft.draft.get(path) : undefined;
  const isNew = drafted?.base === null;
  const q = useFile({ repo, path: path && !isNew ? path : null });
  const href = useKeepParams();
  const navigate = useNavigate();

  if (!path) {
    return (
      <section className={styles.pane} aria-label="File">
        <p className={styles.muted}>Pick a file to read it at {rev}. Mapped files link to their nodes.</p>
        {repo === "app" && topLevel.length > 0 && <p className={styles.muted}>Top level: {topLevel.join(", ")}</p>}
      </section>
    );
  }

  const kind = changeKind(drafted);
  const file = q.data;
  const base = isNew ? null : (file?.text ?? null);
  const text = drafted ? drafted.content : base;
  const unreadable = !!file && (file.binary || file.truncated || file.text === null);
  const nodes = file?.nodes ?? [];
  const describeHref = (id: string) => href("work", { panel: "intent", anchor: id });
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
        <MetaLine items={[{ value: isNew ? "new file" : formatSize(file?.size) }, ...(kind ? [{ value: kind }] : [])]} className={styles.paneMeta} />
        <div className={styles.paneActions}>
          {nodes.length === 1 && (
            <Button asChild variant="secondary" size="compact">
              <Link to={describeHref(nodes[0]!)}>Describe a change</Link>
            </Button>
          )}
          {nodes.length > 1 && (
            <Menu
              label="Describe a change in"
              trigger={<Button variant="secondary" size="compact">Describe a change</Button>}
              items={nodes.map((id) => ({ id, label: id, onSelect: () => navigate(describeHref(id)) }))}
            />
          )}
          {canEdit && readOnly && kind !== "deleted" && (
            <Button type="button" variant="secondary" onClick={onEdit}>Edit</Button>
          )}
          {kind && <Button type="button" variant="ghost" onClick={discard}>Discard</Button>}
          {canEdit && kind !== "deleted" && (
            <Button type="button" variant="danger" className={styles.deleteFile} onClick={() => { draft.remove(path, base); onStopEditing(); }}>Delete file</Button>
          )}
        </div>
      </div>
      {nodes.length > 0 && (
        <ul className={styles.chips} aria-label="Model nodes in this file">
          {nodes.map((id) => (
            <li key={id} className={styles.nodeItem}><NodeChip id={id} size="sm" /></li>
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
          <div className={styles.editorWell}>
          <CodeView
            key={`${repo}:${path}`}
            value={text ?? ""}
            path={path}
            label={readOnly ? `${path} (read-only)` : path}
            readOnly={readOnly}
            onChange={(content) => draft.set(path, base, content)}
          />
          </div>
        </Suspense>
      )}
    </section>
  );
}
