import type { ArtifactsRepoLike, TreeEntry } from "./client";
import { nodesForPath, type SourceMapEntry } from "./source-map";
import { canonicalJson, sha256Hex } from "../util";

export interface TreeDiff { added: string[]; modified: string[]; removed: string[] }

async function entries(repo: ArtifactsRepoLike, tree: string): Promise<Map<string, TreeEntry>> {
  const list = await repo.readTree(tree);
  if (!list) throw new Error(`tree ${tree} not found`);
  return new Map(list.map((e) => [e.name, e] as const));
}

async function allBlobs(repo: ArtifactsRepoLike, tree: string, base: string, out: string[]): Promise<void> {
  for (const [name, e] of await entries(repo, tree)) {
    if (e.type === "tree") await allBlobs(repo, e.hash, `${base}${name}/`, out);
    else if (e.type !== "gitlink") out.push(base + name);
  }
}

async function diffTree(repo: ArtifactsRepoLike, a: string, b: string, base: string, d: TreeDiff): Promise<void> {
  if (a === b) return;
  const [ea, eb] = await Promise.all([entries(repo, a), entries(repo, b)]);
  for (const [name, x] of ea) {
    const y = eb.get(name);
    const p = base + name;
    if (!y) {
      if (x.type === "tree") await allBlobs(repo, x.hash, `${p}/`, d.removed);
      else d.removed.push(p);
    } else if (x.hash !== y.hash || x.type !== y.type) {
      if (x.type === "tree" && y.type === "tree") await diffTree(repo, x.hash, y.hash, `${p}/`, d);
      else if (x.type === "tree") { await allBlobs(repo, x.hash, `${p}/`, d.removed); d.added.push(p); }
      else if (y.type === "tree") { d.removed.push(p); await allBlobs(repo, y.hash, `${p}/`, d.added); }
      else d.modified.push(p);
    }
  }
  for (const [name, y] of eb) {
    if (ea.has(name)) continue;
    const p = base + name;
    if (y.type === "tree") await allBlobs(repo, y.hash, `${p}/`, d.added);
    else d.added.push(p);
  }
}

/** Recursive tree-hash comparison between two commits; identical subtrees are never expanded. */
export async function diffTrees(repo: ArtifactsRepoLike, baseCommit: string, headCommit: string): Promise<TreeDiff> {
  const [a, b] = await Promise.all([repo.readCommit(baseCommit), repo.readCommit(headCommit)]);
  if (!a) throw new Error(`base commit ${baseCommit} not found`);
  if (!b) throw new Error(`commit ${headCommit} not found`);
  const d: TreeDiff = { added: [], modified: [], removed: [] };
  await diffTree(repo, a.treeHash, b.treeHash, "", d);
  d.added.sort(); d.modified.sort(); d.removed.sort();
  return d;
}

export interface CandidateManifest {
  realizationId: string;
  evolutionId: string;
  target: "app" | "genome";
  repo: string;
  baseRepo: string;
  baseCommit: string;
  commit: string;
  changedPaths: string[];
  /** Node ids via source-map; `unmapped:<path>` for misses. Genome realizations: the Genome delta's ids. */
  changedNodes: string[];
  diff: TreeDiff;
  previewUrl?: string;
}

export function changedNodesFor(sourceMap: SourceMapEntry[], paths: string[]): string[] {
  return [...new Set(paths.flatMap((p) => nodesForPath(sourceMap, p)))].sort();
}

export async function buildCandidateManifest(
  repo: ArtifactsRepoLike,
  input: Omit<CandidateManifest, "changedPaths" | "changedNodes" | "diff">,
  sourceMap: SourceMapEntry[],
): Promise<CandidateManifest> {
  const diff = await diffTrees(repo, input.baseCommit, input.commit);
  const changedPaths = [...diff.added, ...diff.modified, ...diff.removed].sort();
  return { ...input, diff, changedPaths, changedNodes: changedNodesFor(sourceMap, changedPaths) };
}

/**
 * Hash of what a candidate binds: repo, base, commit and the exact diff. Recorded at submission and
 * recomputed from the fork at promotion (`promotionFacts.manifestExact`).
 */
export function manifestHash(m: Pick<CandidateManifest, "realizationId" | "target" | "repo" | "baseCommit" | "commit" | "changedPaths" | "diff">): Promise<string> {
  const { realizationId, target, repo, baseCommit, commit, changedPaths, diff } = m;
  return sha256Hex(canonicalJson({ realizationId, target, repo, baseCommit, commit, changedPaths, diff }));
}
