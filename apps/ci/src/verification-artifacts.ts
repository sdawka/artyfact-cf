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

/** Artifacts reads in flight at once: a ~600-file Genome read one blob at a time outlasts the platform's start timeout. */
const READ_CONCURRENCY = 16;

/** `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

/** Breadth first, one level of trees read concurrently, entries checked in tree order. */
async function listYaml(repo: ArtifactsRepo, root: string): Promise<Map<string, ArtifactsTreeEntry>> {
  const out = new Map<string, ArtifactsTreeEntry>();
  let visited = 0;
  for (let level = [{ tree: root, base: "", depth: 1 }]; level.length;) {
    if (level[0]!.depth > MAX_DEPTH) throw new Error(`Genome exceeds ${MAX_DEPTH} directory levels`);
    const listed = await mapLimit(level, READ_CONCURRENCY, (dir) => repo.readTree(dir.tree));
    const next: typeof level = [];
    level.forEach((dir, i) => {
      const entries = listed[i];
      if (!entries) throw new Error(`Artifacts tree ${dir.tree} was not found`);
      for (const entry of entries) {
        visited += 1;
        if (visited > MAX_TREE_ENTRIES) throw new Error(`Genome tree exceeds ${MAX_TREE_ENTRIES} entries`);
        const path = `${dir.base}${entry.name}`;
        if (entry.type === "tree") next.push({ tree: entry.hash, base: `${path}/`, depth: dir.depth + 1 });
        else if (isGenomeSource(path) && entry.type !== "gitlink") {
          out.set(path, entry);
          if (out.size > VERIFICATION_MODEL_MAX_FILES) throw new Error(`Genome exceeds ${VERIFICATION_MODEL_MAX_FILES} files`);
        }
      }
    });
    level = next;
  }
  return out;
}

const fileLimit = (path: string) =>
  path === INTENT_BRIEF_PATH ? INTENT_BRIEF_MAX_BYTES : path === INTENT_MANIFEST_PATH ? INTENT_MANIFEST_MAX_BYTES : MAX_TOTAL_BYTES;

/** Exact, bounded Genome source set (YAML plus intent sidecars), with paths relative to the declared prefix. */
export async function readVerificationGenome(artifacts: Artifacts, ref: VerificationGenomeRef): Promise<Map<string, string>> {
  const repo = await artifacts.get(ref.repo);
  try {
    const sorted = [...await listYaml(repo, await treeAt(repo, ref))].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    // Read concurrently, then check in sorted order so the first error is the same as a sequential read's. Text is
    // skipped once a file or the YAML read so far is over its limit: the checks below then throw at or before it.
    let yamlRead = 0;
    const read = await mapLimit(sorted, READ_CONCURRENCY, async ([path, entry]) => {
      const blob = await repo.readBlob(entry.hash);
      if (!blob) return null;
      if (/\.ya?ml$/.test(path)) yamlRead += blob.size;
      const over = blob.size > fileLimit(path) || yamlRead > MAX_TOTAL_BYTES;
      return { size: blob.size, text: over ? undefined : await blob.text() };
    });
    const files = new Map<string, string>();
    let yamlTotal = 0;
    sorted.forEach(([path], i) => {
      const blob = read[i];
      if (!blob) throw new Error(`Genome file ${path} is missing at ${ref.commit}`);
      if (/\.ya?ml$/.test(path)) {
        if (blob.size > MAX_TOTAL_BYTES) throw new Error(`Genome file ${path} exceeds ${MAX_TOTAL_BYTES} bytes`);
        yamlTotal += blob.size;
        if (yamlTotal > MAX_TOTAL_BYTES) throw new Error(`Genome YAML exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      if (path === INTENT_BRIEF_PATH && blob.size > INTENT_BRIEF_MAX_BYTES) throw new Error("Genome intent brief exceeds 64 KiB");
      if (path === INTENT_MANIFEST_PATH && blob.size > INTENT_MANIFEST_MAX_BYTES) throw new Error("Genome intent manifest exceeds 128 KiB");
      files.set(path, blob.text!);
    });
    if (!files.has("node.yaml") && !files.has("system.yaml")) throw new Error(`Genome root file is missing under ${ref.prefix || "/"}`);
    return files;
  } finally {
    repo[Symbol.dispose]?.();
  }
}
