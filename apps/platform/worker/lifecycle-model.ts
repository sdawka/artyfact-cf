/**
 * The pinned model in a Task fork (docs/design/task-fork-model.md). A lifecycle fork is the app repo plus the pinned
 * Genome under `system/`: {@link seedModel} commits it there over git, {@link modelDelta} diffs a fork commit's
 * `system/` against the pinned Genome (never against the fork's base), and the scope helpers keep `system/**` out of
 * every code-side check so seeding never changes a code candidate's footprint.
 */
import { diffModels, type SemanticDelta, type SystemModel } from "@artyfact/model";
import type { CandidateModel } from "../shared/api";
import type { TaskModel } from "../shared/lifecycle";
import { isModelPath, MODEL_PREFIX } from "../shared/model-path";
import { changedNodesFor, diffSubtrees, diffTrees, type CandidateManifest, type TreeDiff } from "./artifacts/candidates";
import { withRepo, type ArtifactsNamespaceLike, type ArtifactsRepoLike, type TreeEntry } from "./artifacts/client";
import { assertGenomeSourceSize, GENOME_MAX_BYTES, genomePrefix, isGenomeSource, treeAt } from "./artifacts/genome-source";
import { conflict, unprocessable } from "./errors";
import { NODE_FILE } from "@artyfact/ontology/genome";
import { gitTransport } from "./editor";
import { pushCommit, PushRejected, type FileChange } from "./git/push";
import { globMatch, type SourceMapEntry } from "./artifacts/source-map";

export { isModelPath, MODEL_PREFIX };
/** Caps on a candidate's `system/`, checked on the listing before any blob is read (the import path caps total YAML at GENOME_MAX_BYTES). */
export const MODEL_MAX_FILES = 2000;
export const MODEL_MAX_DEPTH = 24;
export const MODEL_MAX_FILE_BYTES = 256 * 1024;
export const MODEL_GLOB = "system/**";
/** Protected in every lifecycle fork; `system/**` is not (it is the model, judged by its own delta). */
export const TASK_PROTECTED = ["assays/**"];
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
  const files = await withRepo(ns, genome.repo, async (r) => readModelFiles(r, genome.commit, await genomePrefix(r, genome.commit)));
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
    const existing = await listModel(repo, parent);
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

/** 422 `model-too-large`: the candidate's `system/` is beyond the caps; nothing of it is read or judged. */
const tooLarge = (what: string, prefix = MODEL_PREFIX) => unprocessable("model-too-large", `the candidate's ${prefix || "root"}/ ${what}; the limits are ${MODEL_MAX_FILES} files, ${MODEL_MAX_DEPTH} levels, ${MODEL_MAX_FILE_BYTES} bytes a file and ${GENOME_MAX_BYTES} bytes of YAML in all`);

/** Walk `tree` (path → entry), refusing mid-walk once the file or depth cap is crossed, so an oversize tree is never listed whole. */
async function listBounded(repo: ArtifactsRepoLike, tree: string, prefix: string, base: string, depth: number, out: Map<string, TreeEntry>): Promise<void> {
  if (depth > MODEL_MAX_DEPTH) throw tooLarge(`nests ${base} deeper than ${MODEL_MAX_DEPTH} levels`, prefix);
  const entries = await repo.readTree(tree);
  if (!entries) throw unprocessable("missing-tree", `tree ${tree} not found`);
  for (const e of entries) {
    const p = base + e.name;
    if (e.type === "tree") await listBounded(repo, e.hash, prefix, `${p}/`, depth + 1, out);
    else if (e.type !== "gitlink") { out.set(p, e); if (out.size > MODEL_MAX_FILES) throw tooLarge(`has more than ${MODEL_MAX_FILES} files`, prefix); }
  }
}

/** The listing of a fork commit's `system/` (or the Genome at `prefix`), refused (422) beyond the file and depth caps before any content is read. */
export async function listModel(repo: ArtifactsRepoLike, commit: string, prefix = MODEL_PREFIX): Promise<Map<string, TreeEntry>> {
  const tree = await treeAt(repo, commit, prefix), out = new Map<string, TreeEntry>();
  if (tree) await listBounded(repo, tree, prefix, "", 1, out);
  return out;
}

/**
 * The model files under `prefix` at `commit` (Genome-relative paths → text), the one capped reader for a candidate's
 * `system/`, the pinned Genome a fork is seeded with and the integrated commit re-read at promote: the listing is capped
 * before a blob is fetched, blobs are fetched one at a time with each size checked before it is decoded, and the running
 * total aborts the fetch loop at GENOME_MAX_BYTES. Source files only. The same bytes go to the loader, to System One
 * and, on promotion, into the accepted Genome.
 */
export async function readModelFiles(repo: ArtifactsRepoLike, commit: string, prefix = MODEL_PREFIX): Promise<Map<string, string>> {
  const listing = await listModel(repo, commit, prefix), out = new Map<string, string>();
  let total = 0;
  for (const [path, e] of [...listing].filter(([p]) => isGenomeSource(p)).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (total > GENOME_MAX_BYTES) throw tooLarge(`exceeds ${GENOME_MAX_BYTES} bytes of source`, prefix);
    const blob = await repo.readBlob(e.hash);
    if (!blob) throw unprocessable("missing-blob", `${prefix ? `${prefix}/` : ""}${path} is missing at ${commit.slice(0, 12)}`);
    // A blob of unknown size counts as over the cap: nothing is decoded on trust.
    if (typeof blob.size !== "number" || blob.size > MODEL_MAX_FILE_BYTES) throw tooLarge(`${path} is ${typeof blob.size === "number" ? blob.size : "unknown"} bytes`, prefix);
    total += blob.size;
    if (total > GENOME_MAX_BYTES) throw tooLarge(`exceeds ${GENOME_MAX_BYTES} bytes of source`, prefix);
    out.set(path, await blob.text());
  }
  assertGenomeSourceSize(out, commit);
  return out;
}

/**
 * The integrated commit's `system/` as the Genome a promotion accepts, through the same capped reader as the submit
 * path. 409 `model-delta-invalid` when the canonical Genome reader (`genomePrefix`) would not find the Genome there: a
 * `node.yaml` or `system.yaml` at the fork root would redirect every later read to a tree nobody reviewed.
 */
export async function integratedModelFiles(ns: ArtifactsNamespaceLike, fork: GenomeRef): Promise<Map<string, string>> {
  return withRepo(ns, fork.repo, async (r) => {
    if ((await genomePrefix(r, fork.commit)) !== MODEL_PREFIX) throw conflict("model-delta-invalid", `the integrated commit ${fork.commit.slice(0, 12)} does not carry its Genome under ${MODEL_PREFIX}/ alone; replan or revise the candidate`);
    return readModelFiles(r, fork.commit);
  });
}

/** Whether `path` is `dir` itself or lies under it, by whole path segments (`a/b` never admits `a/b-2`). */
const underDir = (dir: string, path: string): boolean => path === dir || path.startsWith(`${dir}/`);

/**
 * Changed model files outside the Task's write nodes: a file is inside when it lies under a write node's directory or
 * declares a write node. Paths with no node of their own (a new node under a write node's directory) are inside. With
 * no write nodes nothing is inside: every changed model file is listed.
 */
export function outsideWriteNodes(m: SystemModel, writeNodes: string[], changedPaths: string[]): string[] {
  const dirs = writeNodes.map((id) => m.origin[id]).filter((o): o is string => !!o).map((o) => {
    const rel = o === NODE_FILE ? "" : o.endsWith(`/${NODE_FILE}`) ? o.slice(0, -(NODE_FILE.length + 1)) : o;
    return rel ? `${MODEL_PREFIX}/${rel}` : MODEL_PREFIX;
  });
  const declared = modelPathNodes(m, changedPaths), writes = new Set(writeNodes);
  return changedPaths.filter((p) => !dirs.some((d) => underDir(d, p)) && !(declared[p] ?? []).some((id) => writes.has(id)));
}

/** The pinned Genome tree and the fork commit's `system/` tree, in their own repos. */
async function modelTrees(ns: ArtifactsNamespaceLike, genome: GenomeRef, fork: GenomeRef) {
  const pinned = await withRepo(ns, genome.repo, async (r) => ({ repo: r, tree: await treeAt(r, genome.commit, await genomePrefix(r, genome.commit)) }));
  const cand = await withRepo(ns, fork.repo, async (r) => { const tree = await treeAt(r, fork.commit, MODEL_PREFIX); if (tree) await listModel(r, fork.commit); return { repo: r, tree }; });
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
export async function modelDelta(ns: ArtifactsNamespaceLike, genome: GenomeRef, base: SystemModel, fork: GenomeRef, load: ModelLoader, diff?: TreeDiff, writeNodes: string[] = []): Promise<CandidateModel | null> {
  diff ??= await modelTreeDiff(ns, genome, fork);
  // The whole changed set, deletions included (a rename is an addition and a deletion), is confined to the write nodes.
  const changedPaths = [...diff.added, ...diff.modified, ...diff.removed].sort();
  if (!changedPaths.length) return null;
  const out: CandidateModel = { prefix: MODEL_PREFIX, genomeCommit: genome.commit, changedPaths, changedNodes: [], delta: emptyDelta() };
  const outside = outsideWriteNodes(base, writeNodes, changedPaths); if (outside.length) out.outsideWriteNodes = outside;
  // Over the caps the candidate is refused (422) before a byte of it is parsed; a model that reads but does not load is recorded with its loadError.
  const files = await withRepo(ns, fork.repo, (r) => readModelFiles(r, fork.commit));
  try {
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
export async function buildTaskManifest(ns: ArtifactsNamespaceLike, input: TaskManifestInput, genome: GenomeRef, base: SystemModel, sourceMap: SourceMapEntry[], load: ModelLoader, writeNodes: string[] = []): Promise<TaskManifest> {
  const code = splitDiff(await withRepo(ns, input.repo, (r) => diffTrees(r, input.baseCommit, input.commit))).code;
  const modelDiff = await modelTreeDiff(ns, genome, { repo: input.repo, commit: input.commit });
  const model = await modelDelta(ns, genome, base, { repo: input.repo, commit: input.commit }, load, modelDiff, writeNodes);
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
    const listing = await listModel(r, genome.commit, await genomePrefix(r, genome.commit));
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
