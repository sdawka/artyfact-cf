import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ChangeKind } from "./useDraft";
import { buildTree, filterTree, type FileEntry, type TreeNode } from "./tree";
import styles from "./code.module.css";

export interface FileTreeProps {
  entries: readonly FileEntry[];
  selected: string | null;
  /** Pending change per path (shown as ●). */
  changes: ReadonlyMap<string, ChangeKind>;
  hrefFor(path: string): string;
}

/** The file list as a nested tree with a filter. Files are links to `?path=`; modified files carry ●. */
export function FileTree({ entries, selected, changes, hrefFor }: FileTreeProps) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const tree = useMemo(() => buildTree(entries), [entries]);
  const shown = useMemo(() => filterTree(tree, query), [tree, query]);
  return (
    <nav aria-label="Files" className={styles.tree}>
      <label htmlFor={`${uid}-f`} className={styles.srOnly}>Filter files</label>
      <input id={`${uid}-f`} type="search" className={styles.filter} placeholder="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      {shown.length ? (
        <Nodes nodes={shown} selected={selected} changes={changes} hrefFor={hrefFor} forceOpen={!!query.trim()} />
      ) : (
        <p className={styles.muted}>{entries.length ? "No file matches." : "No files."}</p>
      )}
    </nav>
  );
}

function Nodes({ nodes, selected, changes, hrefFor, forceOpen }: Omit<FileTreeProps, "entries"> & { nodes: TreeNode[]; forceOpen: boolean }) {
  return (
    <ul className={styles.treeList}>
      {nodes.map((n) =>
        n.type === "dir" ? (
          <li key={n.path}>
            <details open={forceOpen || !!selected?.startsWith(`${n.path}/`) || n.path.split("/").length < 2}>
              <summary className={styles.dir}>{n.name}/</summary>
              <Nodes nodes={n.children} selected={selected} changes={changes} hrefFor={hrefFor} forceOpen={forceOpen} />
            </details>
          </li>
        ) : (
          <li key={n.path}>
            <Link
              to={hrefFor(n.path)}
              className={styles.file}
              aria-current={n.path === selected ? "page" : undefined}
              data-change={changes.get(n.path)}
            >
              <span className={styles.fileName}>{n.name}</span>
              {changes.get(n.path) && (
                <span className={styles.changeMark} title={changes.get(n.path)}>
                  <span aria-hidden="true">●</span>
                  <span className={styles.srOnly}> {changes.get(n.path)}</span>
                </span>
              )}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}
