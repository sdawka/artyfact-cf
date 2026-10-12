import { loadSystem, validate, type Readiness, type SystemModel, type TemplateStore } from "@artyfact/model";
import { packsFor, templates as bundledTemplates } from "@artyfact/templates";
import type { ArtifactsRepoLike, TreeEntry } from "./client";

// @artyfact/templates validates with its own Template schema, which differs from the model's in minor
// fields (e.g. hook `verdictMapping`); the store is structurally what loadSystem reads.
export const templates = bundledTemplates as unknown as TemplateStore;

const normPrefix = (p: string) => p.replace(/^\/+|\/+$/g, "");

async function rootTree(repo: ArtifactsRepoLike, commit: string): Promise<string> {
  const meta = await repo.readCommit(commit);
  if (!meta) throw new Error(`commit ${commit} not found in repo`);
  return meta.treeHash;
}

/** Resolve the tree object at `prefix` under `commit`, or null if the prefix does not exist. */
async function treeAt(repo: ArtifactsRepoLike, commit: string, prefix: string): Promise<string | null> {
  let tree = await rootTree(repo, commit);
  for (const part of normPrefix(prefix).split("/").filter(Boolean)) {
    const entries = await repo.readTree(tree);
    const e = entries?.find((x) => x.name === part && x.type === "tree");
    if (!e) return null;
    tree = e.hash;
  }
  return tree;
}

/** Recursively list blob entries: path (relative to the start tree) → entry. Never reads file contents. */
export async function listTreeFrom(repo: ArtifactsRepoLike, tree: string, base = ""): Promise<Map<string, TreeEntry>> {
  const out = new Map<string, TreeEntry>();
  const entries = await repo.readTree(tree);
  if (!entries) throw new Error(`tree ${tree} not found`);
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

/** Where the Genome lives in a repo: root (`system.yaml`) or `system/`. */
export async function genomePrefix(repo: ArtifactsRepoLike, commit: string): Promise<string> {
  const entries = (await repo.readTree(await rootTree(repo, commit))) ?? [];
  if (entries.some((e) => e.name === "system.yaml" && e.type !== "tree")) return "";
  if (entries.some((e) => e.name === "system" && e.type === "tree")) return "system";
  return "";
}

export async function readGenomeFiles(repo: ArtifactsRepoLike, commit: string): Promise<Map<string, string>> {
  return walkTree(repo, commit, await genomePrefix(repo, commit), isYaml);
}

export interface LoadedGenome {
  files: Map<string, string>;
  model: SystemModel;
  readiness: Readiness;
}

/** loadSystem + validate over the System's pinned rule packs. Pure: no Artifacts access. */
export function buildGenome(files: Map<string, string>, revision: string): LoadedGenome {
  const model = loadSystem(files, { revision, templates });
  const readiness = validate(model, packsFor(model.kits.rulePacks));
  return { files, model, readiness };
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

/** Read the Genome at `commit` from Artifacts and build it (memoised per commit). */
export async function loadGenomeAt(repo: ArtifactsRepoLike, commit: string): Promise<LoadedGenome> {
  const hit = memo.get(commit);
  if (hit) return hit;
  const files = await readGenomeFiles(repo, commit);
  return memoGenome(commit, () => buildGenome(files, commit));
}
