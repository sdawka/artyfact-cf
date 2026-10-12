/** A file listing entry (`FilesResponse.files`). */
export interface FileEntry {
  path: string;
  hash: string;
  size?: number;
}

export interface TreeDir {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}
export interface TreeFile {
  type: "file";
  name: string;
  path: string;
  entry: FileEntry;
}
export type TreeNode = TreeDir | TreeFile;

const order = (a: TreeNode, b: TreeNode) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);

/** Nests a flat file list by `/`; directories first, then names in locale order. */
export function buildTree(entries: readonly FileEntry[]): TreeNode[] {
  const root: TreeDir = { type: "dir", name: "", path: "", children: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let dir = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) {
        dir.children.push({ type: "file", name, path, entry });
        return;
      }
      let next = dir.children.find((c): c is TreeDir => c.type === "dir" && c.name === name);
      if (!next) {
        next = { type: "dir", name, path, children: [] };
        dir.children.push(next);
      }
      dir = next;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes.sort(order).map((n) => (n.type === "dir" ? { ...n, children: sort(n.children) } : n));
  return sort(root.children);
}

/** Keeps files whose path contains `query` (case-insensitive) and the directories that lead to them. */
export function filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === "file") {
      if (n.path.toLowerCase().includes(q)) out.push(n);
    } else {
      const children = filterTree(n.children, q);
      if (children.length) out.push({ ...n, children });
    }
  }
  return out;
}
