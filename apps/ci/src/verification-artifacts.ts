import {
  INTENT_BRIEF_MAX_BYTES, INTENT_BRIEF_PATH, INTENT_MANIFEST_MAX_BYTES, INTENT_MANIFEST_PATH, isGenomeSource, VERIFICATION_MODEL_MAX_FILES,
  type VerificationGenomeRef,
} from "@artyfact/model";

const MAX_TREE_ENTRIES = 5_000;
const MAX_DEPTH = 24;
const MAX_TOTAL_BYTES = 1_000_000;

async function treeAt(repo: ArtifactsRepo, ref: VerificationGenomeRef): Promise<string> {
  const commit = await repo.readCommit(ref.commit);
  if (!commit || commit.hash !== ref.commit) throw new Error(`Artifacts commit ${ref.repo}@${ref.commit} was not found`);
  let tree = commit.treeHash;
  for (const part of ref.prefix.split("/").filter(Boolean)) {
    const entries = await repo.readTree(tree);
    const entry = entries?.find((candidate) => candidate.name === part && candidate.type === "tree");
    if (!entry) throw new Error(`Genome prefix ${ref.prefix} was not found at ${ref.repo}@${ref.commit}`);
    tree = entry.hash;
  }
  return tree;
}

async function listYaml(repo: ArtifactsRepo, tree: string, base: string, depth: number, out: Map<string, ArtifactsTreeEntry>, visited: { count: number }): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`Genome exceeds ${MAX_DEPTH} directory levels`);
  const entries = await repo.readTree(tree);
  if (!entries) throw new Error(`Artifacts tree ${tree} was not found`);
  for (const entry of entries) {
    visited.count += 1;
    if (visited.count > MAX_TREE_ENTRIES) throw new Error(`Genome tree exceeds ${MAX_TREE_ENTRIES} entries`);
    const path = `${base}${entry.name}`;
    if (entry.type === "tree") await listYaml(repo, entry.hash, `${path}/`, depth + 1, out, visited);
    else if (isGenomeSource(path) && entry.type !== "gitlink") {
      out.set(path, entry);
      if (out.size > VERIFICATION_MODEL_MAX_FILES) throw new Error(`Genome exceeds ${VERIFICATION_MODEL_MAX_FILES} files`);
    }
  }
}

/** Exact, bounded Genome source set (YAML plus intent sidecars), with paths relative to the declared prefix. */
export async function readVerificationGenome(artifacts: Artifacts, ref: VerificationGenomeRef): Promise<Map<string, string>> {
  const repo = await artifacts.get(ref.repo);
  try {
    const listing = new Map<string, ArtifactsTreeEntry>();
    await listYaml(repo, await treeAt(repo, ref), "", 1, listing, { count: 0 });
    const files = new Map<string, string>();
    let yamlTotal = 0;
    for (const [path, entry] of [...listing].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      const blob = await repo.readBlob(entry.hash);
      if (!blob) throw new Error(`Genome file ${path} is missing at ${ref.commit}`);
      if (/\.ya?ml$/.test(path)) {
        if (blob.size > MAX_TOTAL_BYTES) throw new Error(`Genome file ${path} exceeds ${MAX_TOTAL_BYTES} bytes`);
        yamlTotal += blob.size;
        if (yamlTotal > MAX_TOTAL_BYTES) throw new Error(`Genome YAML exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      if (path === INTENT_BRIEF_PATH && blob.size > INTENT_BRIEF_MAX_BYTES) throw new Error("Genome intent brief exceeds 64 KiB");
      if (path === INTENT_MANIFEST_PATH && blob.size > INTENT_MANIFEST_MAX_BYTES) throw new Error("Genome intent manifest exceeds 128 KiB");
      files.set(path, await blob.text());
    }
    if (!files.has("node.yaml") && !files.has("system.yaml")) throw new Error(`Genome root file is missing under ${ref.prefix || "/"}`);
    return files;
  } finally {
    repo[Symbol.dispose]?.();
  }
}
