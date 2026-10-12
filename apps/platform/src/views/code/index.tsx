import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { FileScope } from "../../../shared/api";
import { useRevisions, useTree } from "@/api/queries";
import { Drawer } from "@/components/Drawer/Drawer";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { RevisionPicker } from "@/components/RevisionPicker/RevisionPicker";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { Tabs } from "@/components/Tabs/Tabs";
import { shortRev } from "@/model/revisions";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSystemRoute, viewPath } from "@/model/useSelection";
import { CommitSheet } from "./CommitSheet";
import { FilePane } from "./FilePane";
import { FileTree } from "./FileTree";
import { PendingChanges } from "./PendingChanges";
import type { FileEntry } from "./tree";
import { useDraft, type ChangeKind } from "./useDraft";
import styles from "./code.module.css";

const REPOS = [
  { id: "genome", label: "Genome" },
  { id: "app", label: "App" },
] as const;
const HEADS = new Set(["head", "canonical"]);

/** Code: browse a repo at a revision, draft edits locally, and commit them as a candidate. */
export default function CodePage() {
  const m = useModel();
  const navigate = useNavigate();
  const href = useKeepParams();
  const [params] = useSearchParams();
  const { systemId, rev } = useSystemRoute();
  const repo: FileScope = params.get("repo") === "app" ? "app" : "genome";
  const path = params.get("path");
  const panel = params.get("panel");
  const fixture = m.bundle.source === "fixture";

  const tree = useTree({ repo });
  const { data: revisions = [] } = useRevisions();
  const draft = useDraft(systemId, repo, rev);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [sheetWidth, setSheetWidth] = useState(440);

  const view = (extra: Record<string, string | null>) => {
    const keep: Record<string, string | null> = { repo: params.get("repo"), path, panel, ...extra };
    return href("code", keep);
  };
  const fileHref = (p: string) => view({ path: p, panel: null });

  const fixtureNoApp = fixture && repo === "app";
  const editBlocked = fixtureNoApp
    ? "The fixture has no app repo."
    : HEADS.has(rev)
      ? null
      : `Editing works on head; this is ${shortRev(rev)}.`;

  const listed: FileEntry[] = useMemo(() => tree.data?.files ?? [], [tree.data]);
  const entries = useMemo(() => {
    const known = new Set(listed.map((f) => f.path));
    const added = draft.pending.filter((c) => c.kind === "added" && !known.has(c.path)).map((c) => ({ path: c.path, hash: "" }));
    return [...listed, ...added];
  }, [listed, draft.pending]);
  const changes = useMemo(() => new Map<string, ChangeKind>(draft.pending.map((c) => [c.path, c.kind])), [draft.pending]);
  const existing = useMemo(() => new Set(entries.map((e) => e.path)), [entries]);

  // A path that is not in the tree may be a document id (Inspector "Open in Code"): open the file it names.
  useEffect(() => {
    if (!path || !tree.data || existing.has(path)) return;
    const stem = (p: string) => (p.split("/").pop() ?? p).replace(/\.[^.]+$/, "");
    const match = listed.find((f) => stem(f.path) === path);
    if (match) navigate(fileHref(match.path), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tree.data, existing]);

  const editing = draft.pending.length > 0 || editingPath !== null;
  const pill = editing ? `editing · ${draft.pending.length} pending` : `read-only · ${HEADS.has(rev) ? "canonical" : shortRev(rev)}`;

  return (
    <section className={styles.view} aria-labelledby="code-title">
      <header className={styles.head}>
        <h1 id="code-title">Code</h1>
        <div className={styles.toolbar}>
          <Tabs tabs={REPOS} value={repo} label="Repository" onChange={(id) => navigate(view({ repo: id, path: null, panel: null }))} />
          <RevisionPicker
            id="code-rev"
            label="Revision"
            value={rev}
            options={revisions}
            onChange={(next) => navigate(href(viewPath(systemId, next, "code"), { repo: params.get("repo"), path, panel: null }))}
          />
          <StatusChip status={editing ? "editing" : "read-only"} label={pill} tone={editing ? "attention" : "neutral"} />
        </div>
      </header>

      <div className={styles.workspace}>
      <div className={styles.content}>
      {fixtureNoApp ? (
        <EmptyState title="The fixture has no app repo.">Switch to Genome to browse the fixture's files.</EmptyState>
      ) : tree.isError ? (
        <p role="alert" className={styles.error}>Could not list files: {tree.error.message}</p>
      ) : (
        <div className={styles.layout}>
          {tree.isPending ? <p className={styles.muted}>Loading files…</p> : <FileTree entries={entries} selected={path} changes={changes} hrefFor={fileHref} />}
          <div className={styles.main}>
            <PendingChanges
              pending={draft.pending}
              existing={existing}
              editBlocked={editBlocked}
              hrefFor={fileHref}
              commitHref={view({ panel: "commit" })}
              onDiscard={(p) => {
                draft.discard(p);
                if (p === editingPath) setEditingPath(null);
              }}
              onNewFile={(p) => {
                draft.newFile(p);
                setEditingPath(p);
                navigate(fileHref(p));
              }}
            />
            <FilePane
              repo={repo}
              path={path}
              draft={draft}
              editBlocked={editBlocked}
              editing={editingPath === path}
              onEdit={() => setEditingPath(path)}
              onStopEditing={() => setEditingPath(null)}
            />
          </div>
        </div>
      )}
      </div>

      <Drawer open={panel === "commit"} label="Commit" width={sheetWidth} onWidthChange={setSheetWidth}>
        <CommitSheet
          repo={repo}
          fixture={fixture}
          changes={draft.toRequestFiles()}
          onClose={() => navigate(view({ panel: null }))}
          onCommitted={() => {
            draft.clear();
            setEditingPath(null);
          }}
        />
      </Drawer>
      </div>
    </section>
  );
}
