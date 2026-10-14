import { useNavigate } from "react-router";
import type { ChangedFiles, FileScope } from "../../../shared/api";
import { Count } from "@/components/Count/Count";
import { ListDetail } from "@/components/ListDetail/ListDetail";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Row, RowList } from "@/components/RowList/RowList";
import { useKeepParams } from "@/model/useSelection";
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

/** Changed-file count across both repos, for the tab. */
export const changedFileCount = (app: ChangedFiles | undefined, genome: ChangedFiles | undefined) => flatten(app).length + flatten(genome).length;

interface Props {
  from: string;
  to: string;
  app: { files: ChangedFiles; pathNodes: Record<string, string[]> } | null | undefined;
  genome: ChangedFiles | undefined;
  path: string | null;
  repo: FileScope | null;
}

/** Changed files of the app and the Genome beside one file's line diff; `?path=` (and `?repo=`) selects it. */
export function FilesLevel({ from, to, app, genome, path, repo }: Props) {
  const href = useKeepParams();
  const navigate = useNavigate();
  const groups: { repo: FileScope; label: string; files: { path: string; status: Status }[] }[] = [
    { repo: "app", label: "App", files: flatten(app?.files) },
    { repo: "genome", label: "Genome", files: flatten(genome) },
  ];
  const selectedRepo: FileScope = repo ?? (path && !groups[0]!.files.some((f) => f.path === path) && groups[1]!.files.some((f) => f.path === path) ? "genome" : "app");
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
              {g.files.map((f) => (
                <Row
                  key={f.path}
                  to={href("compare", { from, to, level: "files", repo: g.repo, path: f.path })}
                  current={f.path === path && g.repo === selectedRepo}
                  title={<><span aria-hidden="true" className={styles.glyph}>{GLYPH[f.status]}</span><code className={styles.filePathText}>{f.path}</code><span className="sr-only"> {f.status}</span></>}
                  trailing={g.repo === "app" ? (app?.pathNodes[f.path] ?? []).map((n) => <NodeChip key={n} id={n} size="sm" />) : undefined}
                />
              ))}
            </RowList>
          ) : (
            <p className={styles.muted}>No {g.label.toLowerCase()} files changed.</p>
          )}
        </section>
      ))}
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
