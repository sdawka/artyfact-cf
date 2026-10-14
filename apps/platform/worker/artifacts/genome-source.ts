import { LegacyGenomeError, loadGenome, validate, type Readiness, type SystemModel, type TemplateStore } from "@artyfact/model";
import { NODE_FILE, V1_ROOT_FILE } from "@artyfact/ontology/genome";
import { metaTemplates } from "@artyfact/templates";
import { unprocessable } from "../errors";
import type { ArtifactsRepoLike, TreeEntry } from "./client";

const normPrefix = (p: string) => p.replace(/^\/+|\/+$/g, "");

async function rootTree(repo: ArtifactsRepoLike, commit: string): Promise<string> {
  const meta = await repo.readCommit(commit);
  if (!meta) throw unprocessable("unknown-commit", `commit ${commit} not found in the repo`);
  return meta.treeHash;
}

/** Resolve the tree object at `prefix` under `commit`, or null if the prefix does not exist. */
async function treeAt(repo: ArtifactsRepoLike, commit: string, prefix: string): Promise<string | null> {
  let tree = await rootTree(repo, commit);
  for (const part of normPrefix(prefix).split("/").filter(Boolean)) {
    const entries = await repo.readTree(tree);
    if (!entries) throw unprocessable("missing-tree", `tree ${tree} (on the way to ${prefix}) not found`);
    const e = entries.find((x) => x.name === part && x.type === "tree");
    if (!e) return null; // the prefix is not present at this commit
    tree = e.hash;
  }
  return tree;
}

/** Recursively list blob entries: path (relative to the start tree) → entry. Never reads file contents. */
export async function listTreeFrom(repo: ArtifactsRepoLike, tree: string, base = ""): Promise<Map<string, TreeEntry>> {
  const out = new Map<string, TreeEntry>();
  const entries = await repo.readTree(tree);
  if (!entries) throw unprocessable("missing-tree", `tree ${tree} not found`);
  const subtrees: Promise<Map<string, TreeEntry>>[] = [];
  for (const e of entries) {
    const p = base + e.name;
    if (e.type === "tree") subtrees.push(listTreeFrom(repo, e.hash, `${p}/`));
    else if (e.type !== "gitlink") out.set(p, e);
  }
  for (const sub of await Promise.all(subtrees)) for (const [p, e] of sub) out.set(p, e);
  return out;
}

export async function listTree(repo: ArtifactsRepoLike, commit: string, prefix = ""): Promise<Map<string, TreeEntry>> {
  const tree = await treeAt(repo, commit, prefix);
  return tree ? listTreeFrom(repo, tree) : new Map();
}

/**
 * Every file under `prefix` at `commit` as path (relative to prefix) → UTF-8 text.
 * readCommit → readTree recursion, then readFile per blob (only those passing `filter`).
 */
export async function walkTree(
  repo: ArtifactsRepoLike,
  commit: string,
  prefix = "",
  filter: (path: string) => boolean = () => true,
): Promise<Map<string, string>> {
  const pre = normPrefix(prefix);
  const listing = await listTree(repo, commit, pre);
  const paths = [...listing.keys()].filter(filter).sort();
  const texts = await Promise.all(
    paths.map(async (p) => {
      const blob = await repo.readFile({ ref: commit, path: pre ? `${pre}/${p}` : p });
      if (!blob) throw new Error(`file ${p} missing at ${commit}`);
      return blob.text();
    }),
  );
  return new Map(paths.map((p, i) => [p, texts[i]] as const));
}

const isYaml = (p: string) => /\.ya?ml$/.test(p);
const INTENT_BRIEF = "intent/brief.md";
const INTENT_MANIFEST = "intent/manifest.json";
const isGenomeSource = (p: string) => isYaml(p) || p === INTENT_BRIEF || p === INTENT_MANIFEST;

/** Where the Genome lives in a repo: root (`node.yaml`, or a legacy `system.yaml`) or `system/`. */
export async function genomePrefix(repo: ArtifactsRepoLike, commit: string): Promise<string> {
  const entries = (await repo.readTree(await rootTree(repo, commit))) ?? [];
  if (entries.some((e) => (e.name === NODE_FILE || e.name === V1_ROOT_FILE) && e.type !== "tree")) return "";
  if (entries.some((e) => e.name === "system" && e.type === "tree")) return "system";
  return "";
}

/**
 * Total YAML bytes a Genome may have. Its files are cached as one DO SQLite row (2 MB cap), so a larger Genome is refused
 * with 422 `genome-too-large` when it is read, instead of failing later with a 500.
 */
export const GENOME_MAX_BYTES = 1_000_000;

export const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function assertGenomeSize(files: Map<string, string>, commit: string): void {
  let total = 0;
  for (const text of files.values()) total += byteLength(text);
  if (total > GENOME_MAX_BYTES) {
    throw unprocessable("genome-too-large", `the Genome at ${commit.slice(0, 12)} has ${total} bytes of YAML; the limit is ${GENOME_MAX_BYTES} bytes`);
  }
}

export async function readGenomeFiles(repo: ArtifactsRepoLike, commit: string): Promise<Map<string, string>> {
  const files = await walkTree(repo, commit, await genomePrefix(repo, commit), isYaml);
  assertGenomeSize(files, commit);
  return files;
}

/** Genome YAML plus the two allowlisted intent sidecars; no other repo content crosses this boundary. */
export async function readGenomeSourceFiles(repo: ArtifactsRepoLike, commit: string): Promise<Map<string, string>> {
  const files = await walkTree(repo, commit, await genomePrefix(repo, commit), isGenomeSource);
  assertGenomeSize(new Map([...files].filter(([path]) => isYaml(path))), commit);
  if (byteLength(files.get(INTENT_BRIEF) ?? "") > 64 * 1024) throw unprocessable("intent-too-large", "intent/brief.md exceeds 64 KiB");
  if (byteLength(files.get(INTENT_MANIFEST) ?? "") > 128 * 1024) throw unprocessable("intent-too-large", "intent/manifest.json exceeds 128 KiB");
  return files;
}

export interface LoadedGenome {
  files: Map<string, string>;
  model: SystemModel;
  readiness: Readiness;
}

/** The 422 a revision in the retired v1 layout answers on model and readiness routes, with the §2a message. */
export const legacyGenome = (e: LegacyGenomeError) => unprocessable("legacy-genome", e.message);

/** loadGenome + readiness over the System's pinned template packs. Pure: no Artifacts access. */
export function buildGenome(files: Map<string, string>, revision: string, templates: TemplateStore = metaTemplates): LoadedGenome {
  let model: SystemModel;
  try {
    model = loadGenome(files, { revision, templates });
  } catch (e) {
    if (e instanceof LegacyGenomeError) throw legacyGenome(e);
    throw e;
  }
  return { files, model, readiness: validate(model) };
}

// Per-isolate memo: genomes are immutable per commit.
const memo = new Map<string, LoadedGenome>();
const MEMO_MAX = 16;

export function memoGenome(key: string, make: () => LoadedGenome): LoadedGenome {
  const hit = memo.get(key);
  if (hit) return hit;
  const g = make();
  memo.set(key, g);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return g;
}

/** Drop every memoised Genome (tests use it to force a reload from Artifacts). */
export function clearGenomeMemo(): void {
  memo.clear();
  scopedMemo = new WeakMap<TemplateStore, Map<string, LoadedGenome>>();
}

/** Read a Genome with an explicitly scoped resolver. Only bundled loads share the legacy memo. */
let scopedMemo = new WeakMap<TemplateStore, Map<string, LoadedGenome>>();
export async function loadGenomeAt(repo: ArtifactsRepoLike, commit: string, templates: TemplateStore = metaTemplates): Promise<LoadedGenome> {
  if (templates === metaTemplates) {
    const hit = memo.get(commit);
    if (hit) return hit;
    const files = await readGenomeFiles(repo, commit);
    return memoGenome(commit, () => buildGenome(files, commit));
  }
  const cache = scopedMemo.get(templates) ?? new Map<string, LoadedGenome>();
  scopedMemo.set(templates, cache);
  const hit = cache.get(commit); if (hit) return hit;
  const loaded = buildGenome(await readGenomeFiles(repo, commit), commit, templates);
  cache.set(commit, loaded);
  if (cache.size > MEMO_MAX) cache.delete(cache.keys().next().value!);
  return loaded;
}
