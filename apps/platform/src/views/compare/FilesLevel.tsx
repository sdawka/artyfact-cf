import { Link } from "react-router";
import type { ChangedFiles, FileScope } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
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

interface Props {
  from: string;
  to: string;
  app: { files: ChangedFiles; pathNodes: Record<string, string[]> } | null | undefined;
  genome: ChangedFiles | undefined;
  path: string | null;
  repo: FileScope | null;
}

/** Changed files of the app and the Genome; `?path=` (and `?repo=`) opens one file's line diff. */
export function FilesLevel({ from, to, app, genome, path, repo }: Props) {
  const href = useKeepParams();
  const groups: { repo: FileScope; label: string; files: { path: string; status: Status }[] }[] = [
    { repo: "app", label: "App", files: flatten(app?.files) },
    { repo: "genome", label: "Genome", files: flatten(genome) },
  ];
  const selectedRepo: FileScope = repo ?? (path && !groups[0]!.files.some((f) => f.path === path) && groups[1]!.files.some((f) => f.path === path) ? "genome" : "app");
  return (
    <div className={styles.files}>
      {groups.map((g) => (
        <section key={g.repo} aria-label={`${g.label} files`}>
          <h3 className={styles.groupHead}>{g.label} <span className={styles.muted}>{g.files.length}</span></h3>
          {g.files.length ? (
            <ul className={styles.fileList}>
              {g.files.map((f) => {
                const selected = f.path === path && g.repo === selectedRepo;
                return (
                  <li key={f.path} data-status={f.status}>
                    <span className={styles.glyph} aria-label={f.status}>{GLYPH[f.status]}</span>
                    <Link
                      to={href("compare", { from, to, level: "files", repo: g.repo, path: f.path })}
                      className="u-marker"
                      {...(selected && { "aria-current": "true" as const })}
                    >
                      <code>{f.path}</code>
                    </Link>
                    {g.repo === "app" && (app?.pathNodes[f.path] ?? []).map((n) => <NodeChip key={n} id={n} size="sm" />)}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.muted}>No {g.label.toLowerCase()} files changed.</p>
          )}
        </section>
      ))}
      {path ? <FileDiff repo={selectedRepo} from={from} to={to} path={path} /> : <p className={styles.muted}>Select a file to see its diff.</p>}
    </div>
  );
}
