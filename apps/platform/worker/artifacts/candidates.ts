import type { EvidenceImageRef } from "../hooks/contract";
import type { ArtifactsRepoLike, TreeEntry } from "./client";
import { nodesForPath, type SourceMapEntry } from "./source-map";
import { unprocessable } from "../errors";
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

/**
 * Compare tree `a` (read from `ra`) with tree `b` (read from `rb`). Git objects are content-addressed (SHA-1), so equal
 * hashes mean equal content even when the two trees live in different repos (a fork and its base, or two forks).
 */
async function diffTree(ra: ArtifactsRepoLike, rb: ArtifactsRepoLike, a: string, b: string, base: string, d: TreeDiff): Promise<void> {
  if (a === b) return;
  const [ea, eb] = await Promise.all([entries(ra, a), entries(rb, b)]);
  for (const [name, x] of ea) {
    const y = eb.get(name);
    const p = base + name;
    if (!y) {
      if (x.type === "tree") await allBlobs(ra, x.hash, `${p}/`, d.removed);
      else d.removed.push(p);
    } else if (x.hash !== y.hash || x.type !== y.type) {
      if (x.type === "tree" && y.type === "tree") await diffTree(ra, rb, x.hash, y.hash, `${p}/`, d);
      else if (x.type === "tree") { await allBlobs(ra, x.hash, `${p}/`, d.removed); d.added.push(p); }
      else if (y.type === "tree") { d.removed.push(p); await allBlobs(rb, y.hash, `${p}/`, d.added); }
      else d.modified.push(p);
    }
  }
  for (const [name, y] of eb) {
    if (ea.has(name)) continue;
    const p = base + name;
    if (y.type === "tree") await allBlobs(rb, y.hash, `${p}/`, d.added);
    else d.added.push(p);
  }
}

/** One side of a cross-repo comparison: a repo handle and a commit in it. */
export interface TreeSide { repo: ArtifactsRepoLike; commit: string }

async function treeOf(side: TreeSide, role: string): Promise<string> {
  const meta = await side.repo.readCommit(side.commit);
  if (!meta) throw unprocessable("unknown-commit", `${role} commit ${side.commit} not found`);
  return meta.treeHash;
}

/**
 * Recursive tree-hash comparison between commits in two repos; identical subtrees are never expanded. A null `from`
 * is the empty tree: every file of `to` is added (the root import compares against nothing).
 */
export async function diffTreesAcross(from: TreeSide | null, to: TreeSide): Promise<TreeDiff> {
  const d: TreeDiff = { added: [], modified: [], removed: [] };
  const [a, b] = await Promise.all([from ? treeOf(from, "base") : null, treeOf(to, "head")]);
  if (a === null) await allBlobs(to.repo, b, "", d.added);
  else await diffTree(from!.repo, to.repo, a, b, "", d);
  d.added.sort(); d.modified.sort(); d.removed.sort();
  return d;
}

/** One side of a subtree comparison: a repo handle and a tree id in it (null = the empty tree). */
export interface SubtreeSide { repo: ArtifactsRepoLike; tree: string | null }

/**
 * Recursive tree-hash comparison of two subtrees (trees, not commits), each in its own repo, with every path reported
 * under `base` (`system/`). A null tree on one side means every file of the other is added or removed.
 */
export async function diffSubtrees(from: SubtreeSide, to: SubtreeSide, base: string): Promise<TreeDiff> {
  const d: TreeDiff = { added: [], modified: [], removed: [] };
  if (from.tree && to.tree) await diffTree(from.repo, to.repo, from.tree, to.tree, base, d);
  else if (to.tree) await allBlobs(to.repo, to.tree, base, d.added);
  else if (from.tree) await allBlobs(from.repo, from.tree, base, d.removed);
  d.added.sort(); d.modified.sort(); d.removed.sort();
  return d;
}

/** Recursive tree-hash comparison between two commits of one repo. */
export function diffTrees(repo: ArtifactsRepoLike, baseCommit: string, headCommit: string): Promise<TreeDiff> {
  return diffTreesAcross({ repo, commit: baseCommit }, { repo, commit: headCommit });
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
  /** Agent-attached screenshots in the evidence bucket; set after submission, like `previewUrl`, outside the hash. */
  screenshots?: EvidenceImageRef[];
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
