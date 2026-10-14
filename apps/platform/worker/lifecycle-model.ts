/**
 * The pinned model in a Task fork (docs/design/task-fork-model.md). A lifecycle fork is the app repo plus the pinned
 * Genome under `system/`: {@link seedModel} commits it there over git, {@link modelDelta} diffs a fork commit's
 * `system/` against the pinned Genome (never against the fork's base), and the scope helpers keep `system/**` out of
 * every code-side check so seeding never changes a code candidate's footprint.
 */
import { diffModels, type SemanticDelta, type SystemModel } from "@artyfact/model";
import type { CandidateModel } from "../shared/api";
import type { TaskModel } from "../shared/lifecycle";
import { changedNodesFor, diffSubtrees, diffTrees, type CandidateManifest, type TreeDiff } from "./artifacts/candidates";
import { withRepo, type ArtifactsNamespaceLike, type ArtifactsRepoLike } from "./artifacts/client";
import { genomePrefix, isGenomeSource, listTree, readGenomeSourceFiles, treeAt, walkTree } from "./artifacts/genome-source";
import { gitTransport } from "./editor";
import { pushCommit, PushRejected, type FileChange } from "./git/push";
import { globMatch, type SourceMapEntry } from "./artifacts/source-map";

export const MODEL_PREFIX = "system";
export const MODEL_GLOB = "system/**";
/** Protected in every lifecycle fork; `system/**` is not (it is the model, judged by its own delta). */
export const TASK_PROTECTED = ["assays/**"];
export const isModelPath = (p: string): boolean => p === MODEL_PREFIX || p.startsWith(`${MODEL_PREFIX}/`);
/** Globs a Task may write: its footprint plus the model. */
export const taskPermittedGlobs = (globs: string[]): string[] => [...new Set([...globs, MODEL_GLOB])];
/** Whether `path` is a code path the Task may change (its footprint, never the model). */
export const inFootprint = (globs: string[], path: string): boolean => !isModelPath(path) && globs.some((g) => globMatch(g, path));
const splitPaths = (paths: string[]) => ({ code: paths.filter((p) => !isModelPath(p)), model: paths.filter(isModelPath) });
export const splitDiff = (d: TreeDiff): { code: TreeDiff; model: TreeDiff } => {
  const a = splitPaths(d.added), m = splitPaths(d.modified), r = splitPaths(d.removed);
  return { code: { added: a.code, modified: m.code, removed: r.code }, model: { added: a.model, modified: m.model, removed: r.model } };
};

export interface GenomeRef { repo: string; commit: string }

/** The pinned Genome's source files (YAML and the intent sidecars) at their fork paths under `system/`. */
export async function pinnedModelFiles(ns: ArtifactsNamespaceLike, genome: GenomeRef): Promise<Map<string, string>> {
  const files = await withRepo(ns, genome.repo, (r) => readGenomeSourceFiles(r, genome.commit));
  return new Map([...files].map(([p, t]) => [`${MODEL_PREFIX}/${p}`, t] as const));
}

export interface SeedOptions {
  /** Replace a `system/` the base already carries (a fork of the app repo). Off, an existing full model is kept (a fork of a predecessor's candidate). */
  overwrite: boolean;
  remote: string;
}

/**
 * Commit the pinned Genome under `system/` on `parent` in `forkRepo` with a short-lived write token, replacing files
 * that differ and removing extras. Returns the fork commit that holds the model: a new one, or `parent` when it already
 * does (or when an existing model is kept).
 */
export async function seedModel(ns: ArtifactsNamespaceLike, forkRepo: string, parent: string, genome: GenomeRef, o: SeedOptions): Promise<string> {
  return withRepo(ns, forkRepo, async (repo) => {
    const existing = await listTree(repo, parent, MODEL_PREFIX);
    if (!o.overwrite && existing.has("node.yaml")) return parent;
    const pinned = await pinnedModelFiles(ns, genome);
    const changes: FileChange[] = [...pinned].map(([path, content]) => ({ path, content }));
    for (const path of existing.keys()) if (!pinned.has(`${MODEL_PREFIX}/${path}`)) changes.push({ path: `${MODEL_PREFIX}/${path}`, content: null });
    const token = await repo.createToken("write", 300);
    try {
      const pushed = await pushCommit({ repo, remote: o.remote, token: token.plaintext, parent, changes, ...gitTransport(), author: { name: "Artyfact", email: "platform@artyfact.local" }, message: `Pin Genome ${genome.commit.slice(0, 12)} under ${MODEL_PREFIX}/` });
      return pushed.commit;
    } catch (e) {
      if (e instanceof PushRejected && e.code === "no-change") return parent;
      throw e;
    } finally {
      await repo.revokeToken(token.id);
    }
  });
}

export const taskModelOf = (genomeCommit: string, commit: string): TaskModel => ({ prefix: MODEL_PREFIX, genomeCommit, commit });

/** Fork path of every node's declaring file (`SystemModel.origin`, Genome-relative) for `ids`. */
export function nodeFilesFor(m: SystemModel, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) if (m.origin[id]) out[id] = `${MODEL_PREFIX}/${m.origin[id]}`;
  return out;
}

/** The inverse of `origin`: node ids per fork path under `system/`, for the scope check's `pathNodes`. */
export function modelPathNodes(m: SystemModel, paths: string[]): Record<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const [id, file] of Object.entries(m.origin)) {
    const key = `${MODEL_PREFIX}/${file}`;
    byFile.set(key, [...(byFile.get(key) ?? []), id]);
  }
  return Object.fromEntries(paths.filter(isModelPath).map((p) => [p, byFile.get(p) ?? []]));
}

/** The pinned Genome tree and the fork commit's `system/` tree, in their own repos. */
async function modelTrees(ns: ArtifactsNamespaceLike, genome: GenomeRef, fork: GenomeRef) {
  const pinned = await withRepo(ns, genome.repo, async (r) => ({ repo: r, tree: await treeAt(r, genome.commit, await genomePrefix(r, genome.commit)) }));
  const cand = await withRepo(ns, fork.repo, async (r) => ({ repo: r, tree: await treeAt(r, fork.commit, MODEL_PREFIX) }));
  return { pinned, cand };
}

const EMPTY_DIFF = (): TreeDiff => ({ added: [], modified: [], removed: [] });

/**
 * `system/**` paths of `fork` that differ from the pinned Genome (added, modified, removed), as a tree diff. A commit
 * with no `system/` at all did not touch the model (a workspace that never carried it), so its diff is empty.
 */
export async function modelTreeDiff(ns: ArtifactsNamespaceLike, genome: GenomeRef, fork: GenomeRef): Promise<TreeDiff> {
  const { pinned, cand } = await modelTrees(ns, genome, fork);
  if (!cand.tree) return EMPTY_DIFF();
  // Only Genome source files are the model: a README or build output beside them is neither seeded nor a delta.
  const d = await diffSubtrees(pinned, cand, `${MODEL_PREFIX}/`), source = (p: string) => isGenomeSource(p.slice(MODEL_PREFIX.length + 1));
  return { added: d.added.filter(source), modified: d.modified.filter(source), removed: d.removed.filter(source) };
}

export type ModelLoader = (files: Map<string, string>, revision: string) => SystemModel;

/**
 * The candidate's model delta: null when its `system/` equals the pinned Genome. Otherwise the changed paths, and
 * the semantic delta of the two loaded models (`loadError` when the candidate's does not load; the delta is then empty).
 */
export async function modelDelta(ns: ArtifactsNamespaceLike, genome: GenomeRef, base: SystemModel, fork: GenomeRef, load: ModelLoader, diff?: TreeDiff): Promise<CandidateModel | null> {
  diff ??= await modelTreeDiff(ns, genome, fork);
  const changedPaths = [...diff.added, ...diff.modified, ...diff.removed].sort();
  if (!changedPaths.length) return null;
  const out: CandidateModel = { prefix: MODEL_PREFIX, genomeCommit: genome.commit, changedPaths, changedNodes: [], delta: emptyDelta() };
  try {
    const files = await withRepo(ns, fork.repo, (r) => walkTree(r, fork.commit, MODEL_PREFIX, (p) => /\.ya?ml$/.test(p)));
    const delta = diffModels(base, load(files, fork.commit));
    out.delta = delta;
    out.changedNodes = [...new Set([...delta.added, ...delta.removed, ...delta.changed.map((c) => c.id)])].sort();
  } catch (e) {
    out.loadError = (e as Error)?.message ?? String(e);
  }
  return out;
}

export interface TaskManifestInput { realizationId: string; repo: string; baseRepo: string; baseCommit: string; commit: string; previewUrl?: string }
export type TaskManifest = CandidateManifest & { model?: CandidateModel };

/**
 * A lifecycle candidate's manifest: code paths are the fork diff vs its base with `system/**` left out (seeding never
 * changes a code footprint); model paths are the candidate's `system/` vs the pinned Genome. `changedNodes` are the code
 * paths' source-map nodes plus the model delta's ids. The hash covers both path sets.
 */
export async function buildTaskManifest(ns: ArtifactsNamespaceLike, input: TaskManifestInput, genome: GenomeRef, base: SystemModel, sourceMap: SourceMapEntry[], load: ModelLoader): Promise<TaskManifest> {
  const code = splitDiff(await withRepo(ns, input.repo, (r) => diffTrees(r, input.baseCommit, input.commit))).code;
  const modelDiff = await modelTreeDiff(ns, genome, { repo: input.repo, commit: input.commit });
  const model = await modelDelta(ns, genome, base, { repo: input.repo, commit: input.commit }, load, modelDiff);
  const diff: TreeDiff = { added: [...code.added, ...modelDiff.added].sort(), modified: [...code.modified, ...modelDiff.modified].sort(), removed: [...code.removed, ...modelDiff.removed].sort() };
  const codePaths = [...code.added, ...code.modified, ...code.removed];
  const changedPaths = [...codePaths, ...(model?.changedPaths ?? [])].sort();
  const changedNodes = [...new Set([...changedNodesFor(sourceMap, codePaths), ...(model?.changedNodes ?? [])])].sort();
  return { ...input, evolutionId: "", target: "app", diff, changedPaths, changedNodes, ...(model && { model }) };
}

export const emptyDelta = (): SemanticDelta => ({ added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] });

/** The pinned Genome's blob entries at their fork paths: the implicit "before" of every model path in a replay. */
export async function pinnedModelEntries(ns: ArtifactsNamespaceLike, genome: GenomeRef) {
  return withRepo(ns, genome.repo, async (r) => {
    const listing = await listTree(r, genome.commit, await genomePrefix(r, genome.commit));
    return new Map([...listing].filter(([p]) => isGenomeSource(p)).map(([p, e]) => [`${MODEL_PREFIX}/${p}`, e] as const));
  });
}

/** The compare "from" side of a changed path: the pinned Genome for a model path (at its path in the Genome repo), else `base`. */
export async function compareFrom(ns: ArtifactsNamespaceLike, genome: GenomeRef, base: { ref: string; repo: string; commit: string }, path: string): Promise<{ from: { ref: string; repo: string; commit: string }; fromPath?: string }> {
  if (!isModelPath(path)) return { from: base };
  const prefix = await withRepo(ns, genome.repo, (r) => genomePrefix(r, genome.commit));
  const rel = path.slice(MODEL_PREFIX.length + 1);
  return { from: { ref: genome.commit, repo: genome.repo, commit: genome.commit }, fromPath: prefix ? `${prefix}/${rel}` : rel };
}

export type { ArtifactsRepoLike };
