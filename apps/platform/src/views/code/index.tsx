import { Button } from "@/components/ui";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useNavigate, useSearchParams } from "react-router";
import type { FileScope } from "../../../shared/api";
import { useTree, type ManualCommitProgress } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { ListDetail } from "@/components/ListDetail/ListDetail";
import { StatusText } from "@/components/StatusText/StatusText";
import { PlusIcon } from "@radix-ui/react-icons";
import { Tabs } from "@/components/Tabs/Tabs";
import { shortRev } from "@/model/revisions";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSystemRoute } from "@/model/useSelection";
import { CommitSheet } from "./CommitSheet";
import { FilePane } from "./FilePane";
import { FileTree } from "./FileTree";
import { NewFileForm, PendingWell } from "./PendingChanges";
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
  const draft = useDraft(systemId, repo, rev);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // A failed commit's evolution, realization and one-time secret, per repo. In memory only (it holds the secret) and
  // outside the panel, which unmounts when it closes, so a retry never starts a second realization.
  const [resume, setResume] = useState<Partial<Record<FileScope, ManualCommitProgress>>>({});

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
  const committing = panel === "commit";
  const topLevel = useMemo(() => [...new Set(listed.map((f) => (f.path.includes("/") ? `${f.path.split("/")[0]}/` : f.path)))].slice(0, 12), [listed]);
  const statusLine = editing
    ? `Editing, ${draft.pending.length} pending`
    : HEADS.has(rev)
      ? "Read-only, canonical"
      : `Read-only at ${shortRev(rev)}. Editing works on head.`;

  const commitAction = draft.pending.length ? (
    <Button asChild variant={committing ? "secondary" : "primary"}><Link to={view({ panel: "commit" })}>Commit changes</Link></Button>
  ) : (
    <Button type="button" variant="primary" reason="Nothing to commit. Edit a file first.">Commit changes</Button>
  );
  const leaveFile = () => navigate(view({ path: null, panel: null }));

  const discard = (p: string) => {
    draft.discard(p);
    if (p === editingPath) setEditingPath(null);
  };

  return (
    <section className={styles.view} aria-labelledby="view-title">
      <PageHeader
        title="Code"
        purpose="Genome and app source at any revision."
        secondary={
          <Button type="button" variant="secondary" onClick={() => setAdding((a) => !a)} disabled={!!editBlocked} aria-expanded={adding}>
            <PlusIcon aria-hidden="true" />New file
          </Button>
        }
        primary={commitAction}
      >
        <div className={styles.toolbar}>
          <Tabs tabs={REPOS} value={repo} label="Repository" onChange={(id) => navigate(view({ repo: id, path: null, panel: null }))} />
          <StatusText status={editing ? "editing" : "read-only"} label={statusLine} tone={editing ? "attention" : "neutral"} glyph={editing ? "◔" : ""} />
        </div>
      </PageHeader>

      {adding && !editBlocked && (
        <NewFileForm
          existing={existing}
          onCancel={() => setAdding(false)}
          onAdd={(p) => {
            draft.newFile(p);
            setEditingPath(p);
            setAdding(false);
            navigate(fileHref(p));
          }}
        />
      )}
      <PendingWell pending={draft.pending} hrefFor={fileHref} onDiscard={discard} />

      {fixtureNoApp ? (
        <EmptyState title="The fixture has no app repo.">Switch to Genome to browse the fixture's files.</EmptyState>
      ) : tree.isError ? (
        <p role="alert" className={styles.error}>Could not list files: {tree.error.message}</p>
      ) : (
        <ListDetail
          listLabel="Repository"
          detailLabel="File"
          listWidth="wide"
          hasSelection={!!path || committing}
          onBack={committing ? undefined : leaveFile}
          backLabel="Back to files"
          list={tree.isPending ? <p className={styles.muted}>Loading files…</p> : <FileTree entries={entries} selected={path} changes={changes} hrefFor={fileHref} />}
          detail={
            committing ? (
              <CommitSheet
                repo={repo}
                fixture={fixture}
                changes={draft.toRequestFiles()}
                onClose={() => navigate(view({ panel: null }))}
                resume={resume[repo] ?? null}
                onResume={(p) => setResume((prev) => ({ ...prev, [repo]: p ?? undefined }))}
                onCommitted={() => {
                  draft.clear();
                  setEditingPath(null);
                }}
              />
            ) : (
              <FilePane
                repo={repo}
                path={path}
                rev={HEADS.has(rev) ? "head" : shortRev(rev)}
                topLevel={topLevel}
                draft={draft}
                editBlocked={editBlocked}
                editing={editingPath === path}
                onEdit={() => setEditingPath(path)}
                onStopEditing={() => setEditingPath(null)}
              />
            )
          }
        />
      )}
    </section>
  );
}
