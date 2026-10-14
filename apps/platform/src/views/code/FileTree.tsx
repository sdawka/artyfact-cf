import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { ChangeKind } from "./useDraft";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import { buildTree, compactTree, filterTree, type FileEntry, type TreeNode } from "./tree";
import styles from "./code.module.css";

export interface FileTreeProps {
  entries: readonly FileEntry[];
  selected: string | null;
  /** Pending change per path (shown as ●). */
  changes: ReadonlyMap<string, ChangeKind>;
  hrefFor(path: string): string;
}

/**
 * The file list as a tree with a filter. Closed by default except the way to the selected file; single-child directories
 * fold into one row ("commitment.x/node.yaml"). Files are links to `?path=`; changed files carry ●.
 */
export function FileTree({ entries, selected, changes, hrefFor }: FileTreeProps) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const tree = useMemo(() => buildTree(entries), [entries]);
  const navRef = useRef<HTMLElement>(null);
  const shown = useMemo(() => compactTree(filterTree(tree, query)), [tree, query]);
  // Reveal the selected file in the list pane's own scroll (nearest: no page jump when it is already visible).
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selected, entries.length]);
  return (
    <nav ref={navRef} aria-label="Files" className={styles.tree}>
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
            <details open={forceOpen || !!selected?.startsWith(`${n.path}/`)}>
              <summary className={styles.dir}><ChevronRightIcon aria-hidden="true" className={styles.chevron} /><FolderGlyph />{n.name}/</summary>
              <Nodes nodes={n.children} selected={selected} changes={changes} hrefFor={hrefFor} forceOpen={forceOpen} />
            </details>
          </li>
        ) : (
          <li key={n.path}>
            <Link
              to={hrefFor(n.path)}
              className={`u-selectable ${styles.file}`}
              title={n.path}
              aria-current={n.path === selected ? "true" : undefined}
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

function FolderGlyph() {
  return (
    <svg aria-hidden="true" className={styles.folder} width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M1.5 3.5h4l1.2 1.5h6.8v7h-12z" />
    </svg>
  );
}
