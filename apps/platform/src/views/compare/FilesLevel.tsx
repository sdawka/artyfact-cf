import { useState } from "react";
import { useNavigate } from "react-router";
import type { ChangedFiles, FileScope } from "../../../shared/api";
import { isModelPath, MODEL_PREFIX, splitPinnedModel } from "../../../shared/model-path";
import { Count } from "@/components/Count/Count";
import { ListDetail } from "@/components/ListDetail/ListDetail";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Row, RowList } from "@/components/RowList/RowList";
import { useKeepParams } from "@/model/useSelection";
import { shortSha } from "@/model/time";
import { FileDiff } from "./FileDiff";
import styles from "./compare.module.css";

const GLYPH = { added: "+", modified: "~", removed: "−" } as const;
type Status = keyof typeof GLYPH;

const flatten = (files: ChangedFiles | undefined): { path: string; status: Status }[] =>
  files
    ? [
        ...files.added.map((path) => ({ path, status: "added" as const })),
        ...files.modified.map((path) => ({ path, status: "modified" as const })),
        ...files.removed.map((path) => ({ path, status: "removed" as const })),
      ].sort((a, b) => a.path.localeCompare(b.path))
    : [];

/**
 * The Files level's groups: the app's code, the Genome, and the pinned model copy the app head carries under
 * `system/` (task-fork-model.md), which is neither an app change nor counted as one.
 */
export function fileGroups(app: ChangedFiles | undefined, genome: ChangedFiles | undefined) {
  const { code, pinned } = app ? splitPinnedModel(app) : { code: undefined, pinned: undefined };
  return { app: flatten(code), genome: flatten(genome), pinned: flatten(pinned) };
}

/** Changed-file count of the app's code and the Genome, for the tab; the pinned model copy is left out. */
export const changedFileCount = (app: ChangedFiles | undefined, genome: ChangedFiles | undefined) => {
  const g = fileGroups(app, genome);
  return g.app.length + g.genome.length;
};

/** The collapsed pinned-copy row's text. */
export const pinnedSummary = (n: number, genomeCommit?: string) =>
  `Pinned Genome copy under ${MODEL_PREFIX}/ · ${n} ${n === 1 ? "file" : "files"}${genomeCommit ? ` · Genome ${shortSha(genomeCommit)}` : ""}`;

interface Props {
  from: string;
  to: string;
  app: { files: ChangedFiles; pathNodes: Record<string, string[]>; pinnedGenome?: string } | null | undefined;
  genome: ChangedFiles | undefined;
  path: string | null;
  repo: FileScope | null;
}

/** Changed files of the app and the Genome beside one file's line diff; `?path=` (and `?repo=`) selects it. */
export function FilesLevel({ from, to, app, genome, path, repo }: Props) {
  const href = useKeepParams();
  const navigate = useNavigate();
  const split = fileGroups(app?.files, genome);
  const groups: { repo: FileScope; label: string; files: { path: string; status: Status }[] }[] = [
    { repo: "app", label: "App", files: split.app },
    { repo: "genome", label: "Genome", files: split.genome },
  ];
  const selectedRepo: FileScope = repo ?? (path && !isModelPath(path) && !groups[0]!.files.some((f) => f.path === path) && groups[1]!.files.some((f) => f.path === path) ? "genome" : "app");
  const [pinnedOpen, setPinnedOpen] = useState(() => !!path && selectedRepo === "app" && isModelPath(path));
  const fileRow = (g: FileScope, f: { path: string; status: Status }) => (
    <Row
      key={f.path}
      to={href("compare", { from, to, level: "files", repo: g, path: f.path })}
      current={f.path === path && g === selectedRepo}
      title={<><span aria-hidden="true" className={styles.glyph}>{GLYPH[f.status]}</span><code className={styles.filePathText}>{f.path}</code><span className="sr-only"> {f.status}</span></>}
      trailing={g === "app" && !isModelPath(f.path) ? (app?.pathNodes[f.path] ?? []).map((n) => <NodeChip key={n} id={n} size="sm" />) : undefined}
    />
  );
  const list = (
    <div className={styles.fileGroups}>
      <p className={styles.legend}>
        <span aria-hidden="true">+ added  ~ modified  − removed</span>
      </p>
      {groups.map((g) => (
        <section key={g.repo} aria-label={`${g.label} files`}>
          <h2 className={styles.groupHead}>{g.label} <Count n={g.files.length} /></h2>
          {g.files.length ? (
            <RowList label={`${g.label} changed files`}>
              {g.files.map((f) => fileRow(g.repo, f))}
            </RowList>
          ) : (
            <p className={styles.muted}>No {g.label.toLowerCase()} files changed.</p>
          )}
        </section>
      ))}
      {split.pinned.length > 0 && (
        <section aria-label="Pinned model copy files">
          <h2 className={styles.groupHead}>Pinned model copy</h2>
          <RowList label="Pinned model copy">
            <Row
              onSelect={() => setPinnedOpen((o) => !o)}
              expanded={pinnedOpen}
              title={pinnedSummary(split.pinned.length, app?.pinnedGenome)}
              meta="Carried by the promoted app head for its Tasks; not an app change."
            >
              <RowList label="Pinned model copy files">{split.pinned.map((f) => fileRow("app", f))}</RowList>
            </Row>
          </RowList>
        </section>
      )}
    </div>
  );
  return (
    <ListDetail
      listLabel="Changed files"
      detailLabel="File diff"
      listWidth="wide"
      hasSelection={!!path}
      onBack={() => navigate(href("compare", { from, to, level: "files", repo: null, path: null }))}
      backLabel="Back to files"
      list={list}
      detail={path ? <FileDiff repo={selectedRepo} from={from} to={to} path={path} /> : <p className={styles.muted}>Select a file to see its diff.</p>}
    />
  );
}
