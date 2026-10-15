/**
 * Revision resolution and comparisons across System commits, candidates and forks (Changelog, Compare, revision
 * pickers, the editor's commit base). All Artifacts reads happen here, never in the DO.
 */
import type { SystemModel } from "@artyfact/model";
import { diffModels } from "@artyfact/model";
import { NODE_FILE } from "@artyfact/ontology/genome";
import type {
  ChangedFiles, FileCompare, FileScope, ModelDelta, FileSide, GenomeCompare, ResolvedRef, RevisionOption, RevisionsResponse, SystemCommit, SystemCompare,
} from "../shared/api";
import { canonicalJson } from "./util";
import { diffTreesAcross } from "./artifacts/candidates";
import { artifactsErrorCode, artifactsFor, withRepo, type ArtifactsRepoLike } from "./artifacts/client";
import { nodesForPath, sourceMapFor } from "./artifacts/source-map";
import type { HeadState } from "./do/system-authority";
import { badRequest, HttpError, notFound, unprocessable } from "./errors";
import { genomeAt, systemStub, type SystemApi } from "./service";

export type RefScope = FileScope;
export type { ResolvedRef };

const COMMIT_RE = /^[0-9a-f]{40}$/;
const SC_RE = /^sc-(\d+)(-[0-9a-f]{8})?$/;
const CANDIDATE_RE = /^candidate\.[\w.-]+$/;
const REALIZATION_RE = /^realization\.[\w.-]+$/;

/** The app binding of a System commit (the platform binds one worker-fullstack artifact). */
function appBinding(c: SystemCommit): { repo: string; commit: string } {
  const b = c.manifest[0] ?? Object.values(c.composition?.artifacts ?? {})[0];
  if (!b?.repo || !b.commit) throw unprocessable("no-app-binding", `System commit ${c.id} binds no app artifact`);
  return { repo: b.repo, commit: b.commit };
}

/**
 * Repo holding Genome commit `commit`: the fork of the Genome candidate that produced it (accepted amendments live in
 * their fork), else the imported Genome repo.
 */
async function genomeRepoFor(stub: SystemApi, head: HeadState, commit: string): Promise<string> {
  if (commit === head.genomeCommit) return head.genomeSource;
  const known = await stub.revisionOfCommit(commit);
  if (known && "candidate" in known) {
    const c = await stub.candidate(known.candidate);
    const rec = c && (await stub.realization(c.realization));
    if (rec?.target === "genome") return rec.forkRepo;
  }
  return head.genomeRepo;
}

/** A System commit by full id (`sc-3-1a2b3c4d`) or by sequence (`sc-3`). */
export async function findSystemCommit(stub: SystemApi, id: string): Promise<SystemCommit | null> {
  const exact = await stub.systemCommit(id);
  if (exact) return exact;
  const m = SC_RE.exec(id);
  if (!m || m[2]) return null;
  return (await stub.history()).find((c) => c.id.startsWith(`sc-${m[1]}-`)) ?? null;
}

async function atSystemCommit(stub: SystemApi, head: HeadState, scope: RefScope, ref: string, c: SystemCommit): Promise<ResolvedRef> {
  if (scope === "app") return { ref, ...appBinding(c), systemCommit: c.id };
  return { ref, repo: await genomeRepoFor(stub, head, c.genomeCommit), commit: c.genomeCommit, systemCommit: c.id };
}

function atHead(head: HeadState, scope: RefScope, ref: string): ResolvedRef {
  const sc = head.head ? { systemCommit: head.head } : {};
  if (scope === "app") {
    if (!head.appSource) throw notFound("This Thing has no source artifact yet");
    return { ref, repo: head.appSource.repo, commit: head.appSource.commit, ...sc };
  }
  return { ref, repo: head.genomeSource, commit: head.genomeCommit, ...sc };
}

/** Scope `scope` as of the System commit a realization was based on (the head when it has none). */
async function atBase(stub: SystemApi, head: HeadState, scope: RefScope, ref: string, baseRevision: string | null): Promise<ResolvedRef> {
  const base = baseRevision ? await stub.systemCommit(baseRevision) : null;
  return base ? atSystemCommit(stub, head, scope, ref, base) : atHead(head, scope, ref);
}

async function atCandidate(stub: SystemApi, head: HeadState, scope: RefScope, ref: string, id: string): Promise<ResolvedRef> {
  const c = await stub.candidate(id);
  if (!c) throw notFound(`unknown candidate ${id}`);
  const rec = await stub.realization(c.realization);
  if (!rec) throw notFound(`candidate ${id} names unknown realization ${c.realization}`);
  // A candidate of the other scope leaves this one as it was at the candidate's base.
  if (rec.target !== scope) return { ...(await atBase(stub, head, scope, ref, c.baseRevision || null)), candidate: id };
  return { ref, repo: rec.forkRepo, commit: c.commit, ...(c.baseRevision && { systemCommit: c.baseRevision }), candidate: id };
}

async function atRealization(env: Env, stub: SystemApi, head: HeadState, scope: RefScope, ref: string): Promise<ResolvedRef> {
  const rec = await stub.realization(ref);
  if (!rec) throw notFound(`unknown realization ${ref}`);
  const baseRevision = rec.realization.baseRevision ?? null;
  if (rec.target !== scope) return atBase(stub, head, scope, ref, baseRevision);
  // The realization's fork head; a fork that is gone or empty is still at its base commit.
  const [tip] = await withRepo(artifactsFor(env), rec.forkRepo, (r) => r.log({ limit: 1 })).catch((e: unknown) => {
    if (artifactsErrorCode(e) === "NOT_FOUND") return [];
    throw e;
  });
  const commit = tip?.hash ?? rec.baseCommit;
  const cand = (await stub.candidates({ realizationId: ref })).find((c) => c.commit === commit);
  return { ref, repo: tip ? rec.forkRepo : rec.baseRepo, commit, ...(baseRevision && { systemCommit: baseRevision }), ...(cand && { candidate: cand.id }) };
}

/** A recorded 40-hex commit: a candidate's, or one a System commit binds. Never read from Artifacts unrecorded. */
async function atCommit(stub: SystemApi, head: HeadState, scope: RefScope, sha: string): Promise<ResolvedRef> {
  const known = await stub.revisionOfCommit(sha);
  if (known && "candidate" in known) return atCandidate(stub, head, scope, sha, known.candidate);
  if (scope === "app" && sha === head.appSource?.commit) return atHead(head, scope, sha);
  if (scope === "genome" && sha === head.genomeCommit) return atHead(head, scope, sha);
  // Oldest first: the System commit that first bound this commit.
  const history = (await stub.history()).reverse();
  const own = history.find((c) => (scope === "app" ? c.manifest.some((b) => b.commit === sha) : c.genomeCommit === sha));
  if (own) return { ...(await atSystemCommit(stub, head, scope, sha, own)), commit: sha };
  // A commit of the other scope names the System commit that bound it.
  const other = history.find((c) => (scope === "app" ? c.genomeCommit === sha : c.manifest.some((b) => b.commit === sha)));
  if (other) return atSystemCommit(stub, head, scope, sha, other);
  throw notFound(`commit ${sha} is not recorded in ${head.systemId} (System commits or candidates)`);
}

/**
 * Resolve `ref` for `scope`: `head` (or `canonical`), a System commit (`sc-N` or its full id), a candidate id, a
 * recorded 40-hex commit, or a realization id (its fork head). 400 for a malformed ref, 404 for an unknown one.
 */
export async function resolveRef(env: Env, head: HeadState, scope: RefScope, ref: string): Promise<ResolvedRef> {
  const stub = systemStub(env, head.systemId);
  if (ref === "head" || ref === "canonical" || (head.head && ref === head.head)) return atHead(head, scope, ref);
  if (SC_RE.test(ref)) {
    const c = await findSystemCommit(stub, ref);
    if (!c) throw notFound(`unknown System commit ${ref}`);
    return atSystemCommit(stub, head, scope, ref, c);
  }
  if (CANDIDATE_RE.test(ref)) return atCandidate(stub, head, scope, ref, ref);
  if (COMMIT_RE.test(ref)) return atCommit(stub, head, scope, ref);
  if (REALIZATION_RE.test(ref)) return atRealization(env, stub, head, scope, ref);
  throw badRequest(`malformed ref ${JSON.stringify(ref.slice(0, 80))}: use head, sc-N, a candidate id, a 40-hex commit or a realization id`);
}

// ------------------------------------------------------------------ System sides

export async function headStateOf(env: Env, systemId: string): Promise<HeadState> {
  const s = await systemStub(env, systemId).state();
  if (!s?.head) throw notFound(`system ${systemId} is not imported`);
  return s;
}

/**
 * One side of a System comparison: a System commit and its app + Genome resolved to repos. A candidate, 40-hex commit
 * or realization is a synthetic System commit (`synthetic`): its base System commit with that revision's bindings.
 */
export interface SystemSide {
  commit: SystemCommit;
  app: ResolvedRef | null;
  genome: ResolvedRef;
  /** The base System commit of a synthetic side. */
  base?: string;
}

async function resolveApp(env: Env, head: HeadState, ref: string): Promise<ResolvedRef | null> {
  try {
    return await resolveRef(env, head, "app", ref);
  } catch (e) {
    if (e instanceof HttpError && e.code === "no-app-binding") return null;
    throw e;
  }
}

export async function sideOfCommit(env: Env, head: HeadState, c: SystemCommit, ref = c.id): Promise<SystemSide> {
  const [app, genome] = await Promise.all([resolveApp(env, head, ref), resolveRef(env, head, "genome", ref)]);
  return { commit: c, app, genome };
}

/** The System side `ref` names (see {@link resolveRef} for the accepted forms). */
export async function sideAt(env: Env, head: HeadState, ref: string): Promise<SystemSide> {
  const stub = systemStub(env, head.systemId);
  if (ref === "head" || ref === "canonical" || SC_RE.test(ref)) {
    const id = SC_RE.test(ref) ? ref : head.head!;
    const c = await findSystemCommit(stub, id);
    if (!c) throw notFound(`unknown System commit ${ref}`);
    return sideOfCommit(env, head, c, ref);
  }
  const [app, genome] = await Promise.all([resolveApp(env, head, ref), resolveRef(env, head, "genome", ref)]);
  const baseId = app?.systemCommit ?? genome.systemCommit ?? head.head!;
  const base = (await stub.systemCommit(baseId)) ?? (await stub.systemCommit(head.head!));
  if (!base) throw notFound(`System commit ${baseId} is missing`);
  const artifactId = Object.keys(base.composition?.artifacts ?? {})[0] ?? base.manifest[0]?.artifact ?? "artifact.webapp";
  const binding = app ? { repo: app.repo, commit: app.commit } : null;
  const candidate = app?.candidate ?? genome.candidate;
  const commit: SystemCommit = {
    ...base,
    id: ref, parent: base.id, genomeCommit: genome.commit,
    manifest: binding ? [{ ...(base.manifest[0] ?? { artifact: artifactId, type: "worker-fullstack" as const, scope: [] }), ...binding }] : base.manifest,
    ...(base.composition && {
      composition: { ...base.composition, genomeCommit: genome.commit, artifacts: binding ? { ...base.composition.artifacts, [artifactId]: { ...base.composition.artifacts[artifactId], ...binding } } : base.composition.artifacts },
    }),
    evolutions: [], candidates: candidate ? [candidate] : [], rejected: [], evidence: [],
    decision: { by: "", policy: "uncommitted", rationale: "", at: "" },
  };
  delete commit.manifestHash;
  delete commit.createdAt;
  return { commit, app, genome, base: base.id };
}

/** The side a comparison starts from when `from` is omitted: a synthetic side's base, else the commit's parent. */
export async function defaultFrom(env: Env, head: HeadState, to: SystemSide): Promise<SystemSide | null> {
  const id = to.base ?? to.commit.parent;
  if (!id) return null;
  const c = await systemStub(env, head.systemId).systemCommit(id);
  return c ? sideOfCommit(env, head, c) : null;
}

// ------------------------------------------------------------------ comparisons

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Against nothing: every indexed object is added. */
function addedOnly(m: SystemModel): ModelDelta {
  const byId = m.index.byId;
  return {
    added: sorted(Object.keys(byId)), removed: [], changed: [],
    affectedCriteria: sorted(m.criteria.map((c) => c.id)),
    affectedJourneys: sorted(Object.keys(byId).filter((id) => byId[id]!.type === "journey")),
  };
}

const loadErr = (e: unknown) => (e as Error)?.message ?? String(e);

interface GenomeSides {
  delta: ModelDelta | null; loadError?: string; toModel?: SystemModel; fromModel?: SystemModel;
  /** Sides in the retired v1 layout: never loaded, so there is no delta. */
  legacyFormat?: ("from" | "to")[];
}

/** A revision in the retired v1 layout (the 422 `legacy-genome` that `buildGenome` throws). */
export const isLegacyGenome = (e: unknown) => e instanceof HttpError && e.code === "legacy-genome";

/** Semantic delta between two Genome sides; null when they are the same commit or a side does not load. */
async function genomeDelta(env: Env, systemId: string, from: ResolvedRef | null, to: ResolvedRef): Promise<GenomeSides> {
  const legacy: ("from" | "to")[] = [];
  const modelAt = (ref: ResolvedRef, side: "from" | "to") => genomeAt(env, systemId, ref.commit, ref.repo).then((g) => g.model, (e: unknown) => {
    if (!isLegacyGenome(e)) throw e;
    legacy.push(side);
    return undefined;
  });
  try {
    const b = await modelAt(to, "to");
    const a = from && from.commit !== to.commit ? await modelAt(from, "from") : undefined;
    if (from && from.commit === to.commit && legacy.length) legacy.unshift("from");
    if (legacy.length) return { delta: null, legacyFormat: legacy, ...(b && { toModel: b }), ...(a && { fromModel: a }) };
    if (!from) return { delta: addedOnly(b!), toModel: b };
    if (!a) return { delta: null, toModel: b };
    return { delta: diffModels(a, b!), toModel: b, fromModel: a };
  } catch (e) {
    return { delta: null, loadError: loadErr(e) };
  }
}

/**
 * Per changed Genome path, the delta's nodes declared in it: added/changed nodes by where `to` declares them, removed
 * ones by where `from` did. Model origins are relative to the Genome's root, which may sit under a repo prefix.
 */
export function genomePathNodes(g: GenomeSides, paths: string[]): Record<string, string[]> {
  const d = g.delta;
  if (!d || !paths.length) return {};
  const declared: [id: string, file: string | undefined][] = [
    ...[...d.added, ...d.changed.map((c) => c.id)].map((id) => [id, g.toModel?.origin[id]] as [string, string | undefined]),
    ...d.removed.map((id) => [id, g.fromModel?.origin[id]] as [string, string | undefined]),
  ];
  return Object.fromEntries(paths.map((p) => [p, sorted(declared.filter(([, file]) => declaredAt(p, file)).map(([id]) => id))]));
}

const GENOME_DIR = "system/";
/** A repo path relative to the Genome's root: the Genome sits at the repo root or under `system/` (see `genomePrefix`). */
const genomeRelative = (path: string) => (path.startsWith(GENOME_DIR) ? path.slice(GENOME_DIR.length) : path);

/** Whether repo path `path` is the Genome file `file` (model origins are relative to the Genome's root). */
const declaredAt = (path: string, file: string | undefined) => !!file && (path === file || genomeRelative(path) === file);

/**
 * Per repo path, the ids model `m` declares in it (by the same match as {@link genomePathNodes}): a `node.yaml`
 * declares its node and the criteria and hooks inline in it. Any other file belongs to the node whose directory
 * contains it (the Genome is a node tree).
 */
export function declaredNodes(m: SystemModel, paths: string[]): Record<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const [id, file] of Object.entries(m.origin)) {
    if (!m.index.byId[id]) continue;
    const ids = byFile.get(file);
    if (ids) ids.push(id);
    else byFile.set(file, [id]);
  }
  const declared = (p: string) => sorted([...(byFile.get(p) ?? []), ...(byFile.get(genomeRelative(p)) ?? [])]);
  // A node directory's own node (criteria and hooks declared inline share its file).
  const ownNode = (file: string) => declared(file).filter((id) => m.index.byId[id]!.type !== "criterion" && m.index.byId[id]!.type !== "hook");
  const enclosing = (p: string): string[] => {
    const parts = p.split("/").slice(0, -1);
    for (let n = parts.length; n >= 0; n--) {
      const hit = ownNode([...parts.slice(0, n), NODE_FILE].join("/"));
      if (hit.length) return hit;
    }
    return [];
  };
  return Object.fromEntries(paths.map((p) => {
    const own = declared(p);
    return [p, own.length ? own : enclosing(p)];
  }));
}

/** Changed files between two repo sides (`from` null = everything added). Same commit: nothing changed, nothing read. */
export async function changedFiles(env: Env, from: ResolvedRef | null, to: ResolvedRef): Promise<ChangedFiles> {
  if (from && from.commit === to.commit) return { added: [], modified: [], removed: [] };
  const ns = artifactsFor(env);
  return withRepo(ns, to.repo, (rb) =>
    from ? withRepo(ns, from.repo, (ra) => diffTreesAcross({ repo: ra, commit: from.commit }, { repo: rb, commit: to.commit }))
      : diffTreesAcross(null, { repo: rb, commit: to.commit }));
}

/** Model nodes per app path, from the node-attached source map of the Genome model `m` (none without one). */
export function pathNodesAt(m: SystemModel | undefined, paths: string[]): Record<string, string[]> {
  if (!paths.length) return {};
  const sm = m ? sourceMapFor(m) : [];
  return Object.fromEntries(paths.map((p) => [p, nodesForPath(sm, p).filter((n) => !n.startsWith("unmapped:"))]));
}

function changedKeys(a: Record<string, string> | undefined, b: Record<string, string> | undefined): string[] {
  const x = a ?? {}, y = b ?? {};
  return sorted([...Object.keys(x), ...Object.keys(y)].filter((k) => x[k] !== y[k]));
}

/**
 * Two System sides: Genome commits + semantic delta and changed files, the app's changed files (across forks) with the nodes each path
 * maps to at `to`, and which manifest keys changed. `from` null compares against nothing (the root import).
 */
export async function compareSystem(env: Env, head: HeadState, from: SystemSide | null, to: SystemSide): Promise<SystemCompare> {
  // A Genome kept in the app repo at the same commits is already covered by the app's files.
  const sameRepo = (a: ResolvedRef | null | undefined, b: ResolvedRef | null | undefined) => (a ?? null) === (b ?? null) || (!!a && !!b && a.repo === b.repo && a.commit === b.commit);
  const genomeInApp = !!to.app && sameRepo(to.genome, to.app) && sameRepo(from?.genome, from?.app);
  const [genome, files, genomeFiles] = await Promise.all([
    genomeDelta(env, head.systemId, from?.genome ?? null, to.genome),
    to.app ? changedFiles(env, from?.app ?? null, to.app) : null,
    genomeInApp ? { added: [], modified: [], removed: [] } : changedFiles(env, from?.genome ?? null, to.genome).catch((e: unknown) => loadErr(e)),
  ]);
  const gFiles = typeof genomeFiles === "string" ? null : genomeFiles;
  const gLoadError = genome.loadError ?? (typeof genomeFiles === "string" ? genomeFiles : undefined);
  const app = to.app && files
    ? { from: from?.app ?? null, to: to.app, files, pathNodes: pathNodesAt(genome.toModel, [...files.added, ...files.modified, ...files.removed]) }
    : null;
  const fc = from?.commit.composition, tc = to.commit.composition;
  const manifest = {
    templateVersions: changedKeys(fc?.templateVersions, tc?.templateVersions),
    hookVersions: changedKeys(fc?.hookVersions, tc?.hookVersions),
    platformChanged: canonicalJson(fc?.platform ?? null) !== canonicalJson(tc?.platform ?? null),
  };
  const identical = !!from && from.genome.commit === to.genome.commit && (from.app?.commit ?? null) === (to.app?.commit ?? null)
    && !manifest.templateVersions.length && !manifest.hookVersions.length && !manifest.platformChanged;
  return {
    from: from?.commit ?? null, to: to.commit,
    genome: {
      from: from?.genome.commit ?? null, to: to.genome.commit, delta: genome.delta, files: gFiles,
      pathNodes: gFiles ? genomePathNodes(genome, [...gFiles.added, ...gFiles.modified, ...gFiles.removed]) : {},
      ...(gLoadError && { loadError: gLoadError }), ...(genome.legacyFormat && { legacyFormat: genome.legacyFormat }),
    },
    app, manifest, identical,
  };
}

/** `from` omitted = the parent (or a synthetic side's base) of `to`. */
async function sides(env: Env, head: HeadState, fromRef: string | undefined, toRef: string): Promise<[SystemSide | null, SystemSide]> {
  const to = await sideAt(env, head, toRef);
  const from = fromRef ? await sideAt(env, head, fromRef) : await defaultFrom(env, head, to);
  return [from, to];
}

export async function compareSystemRefs(env: Env, systemId: string, fromRef: string | undefined, toRef: string): Promise<SystemCompare> {
  const head = await headStateOf(env, systemId);
  const [from, to] = await sides(env, head, fromRef, toRef);
  return compareSystem(env, head, from, to);
}

export async function compareGenome(env: Env, systemId: string, fromRef: string | undefined, toRef: string): Promise<GenomeCompare> {
  const head = await headStateOf(env, systemId);
  const to = await resolveRef(env, head, "genome", toRef);
  const from = fromRef ? await resolveRef(env, head, "genome", fromRef) : (await defaultFrom(env, head, await sideAt(env, head, toRef)))?.genome ?? null;
  const [g, files] = await Promise.all([genomeDelta(env, systemId, from, to), changedFiles(env, from, to)]);
  return { from, to, delta: g.delta, ...(g.loadError && { loadError: g.loadError }), ...(g.legacyFormat && { legacyFormat: g.legacyFormat }), files };
}

// ------------------------------------------------------------------ file compare

/** Bytes of text returned per side; a larger file is cut here and flagged `truncated`. */
export const FILE_COMPARE_MAX_BYTES = 512 * 1024;

export function validPath(path: unknown): string {
  if (typeof path !== "string" || !path || path.length > 1024 || path.startsWith("/") || path.includes("\0") || path.split("/").some((p) => p === ".." || p === "." || p === "")) {
    throw badRequest("path must be a repo-relative file path (no leading /, no . or .. segments)");
  }
  return path;
}

/** The blob entry at `path` under `commit`, or null when the path is absent (or a directory). */
async function blobAt(repo: ArtifactsRepoLike, commit: string, path: string): Promise<string | null> {
  const meta = await repo.readCommit(commit);
  if (!meta) throw unprocessable("unknown-commit", `commit ${commit} not found`);
  let tree = meta.treeHash;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const e = (await repo.readTree(tree))?.find((x) => x.name === parts[i]);
    if (!e) return null;
    if (i === parts.length - 1) return e.type === "tree" || e.type === "gitlink" ? null : e.hash;
    if (e.type !== "tree") return null;
    tree = e.hash;
  }
  return null;
}

interface ReadSide { side: FileSide; truncated: boolean; binary: boolean }

async function readSide(env: Env, ref: ResolvedRef, path: string): Promise<ReadSide> {
  return withRepo(artifactsFor(env), ref.repo, async (repo) => {
    const hash = await blobAt(repo, ref.commit, path);
    if (!hash) return { side: { ...ref, hash: null, text: null, size: 0 }, truncated: false, binary: false };
    const blob = await repo.readBlob(hash);
    if (!blob) throw unprocessable("missing-blob", `blob ${hash} (${path}) not found in ${ref.repo}`);
    const bytes = new Uint8Array(await blob.slice(0, FILE_COMPARE_MAX_BYTES).arrayBuffer());
    const binary = bytes.includes(0);
    const truncated = blob.size > FILE_COMPARE_MAX_BYTES;
    // A cut text drops a trailing partial UTF-8 sequence (a streaming decode holds it back) instead of ending in U+FFFD.
    const text = binary ? null : new TextDecoder().decode(bytes, { stream: truncated });
    return { side: { ...ref, hash, text, size: blob.size }, truncated, binary };
  });
}

/** One path on two sides of a scope: text (cut at 512 KB, `truncated`), or `binary` (a NUL byte) with no text. */
export async function compareFile(env: Env, systemId: string, scope: unknown, fromRef: string | undefined, toRef: string, rawPath: unknown): Promise<FileCompare> {
  if (scope !== "app" && scope !== "genome") throw badRequest("scope must be app or genome");
  const path = validPath(rawPath);
  const head = await headStateOf(env, systemId);
  const to = await resolveRef(env, head, scope, toRef);
  const fromSide = fromRef ? null : await defaultFrom(env, head, await sideAt(env, head, toRef));
  const from = fromRef ? await resolveRef(env, head, scope, fromRef) : scope === "app" ? fromSide?.app ?? null : fromSide?.genome ?? null;
  const b = await readSide(env, to, path);
  const a = from ? await readSide(env, from, path) : { side: { ref: "", repo: "", commit: "", hash: null, text: null, size: 0 }, truncated: false, binary: false };
  const binary = a.binary || b.binary;
  const strip = (x: FileSide): FileSide => (binary ? { ...x, text: null } : x);
  return { path, from: strip(a.side), to: strip(b.side), truncated: a.truncated || b.truncated, binary };
}

// ------------------------------------------------------------------ revisions

export type CommitKind = "import" | "promotion" | "acceptance";

export function commitKind(c: Pick<SystemCommit, "decision">): CommitKind {
  if (c.decision.policy === "import") return "import";
  if (c.decision.policy === "admin-accept") return "acceptance";
  return "promotion";
}

/** `sc-3-1a2b3c4d` → `sc-3`. */
export const shortCommitId = (id: string) => /^(sc-\d+)-/.exec(id)?.[1] ?? id;

/** The revision picker: the head, System commits newest first, then open candidates newest first. */
export async function revisions(env: Env, systemId: string): Promise<RevisionsResponse> {
  const head = await headStateOf(env, systemId);
  const stub = systemStub(env, systemId);
  const [history, evolutions, open] = await Promise.all([stub.history(), stub.evolutions(), stub.candidates({ open: true })]);
  const title = new Map(evolutions.map((e) => [e.id, e.title] as const));
  const top = history[0];
  const out: RevisionOption[] = [{ id: "head", kind: "head", label: `head (${shortCommitId(head.head!)})`, ...(top?.createdAt && { at: top.createdAt }) }];
  for (const c of history) {
    const evo = c.evolutions[0];
    const what = evo ? `${commitKind(c)} · ${title.get(evo) ?? evo}` : commitKind(c);
    out.push({ id: c.id, kind: "commit", label: `${shortCommitId(c.id)} ${what}`, ...(c.createdAt && { at: c.createdAt }), ...(evo && { evolution: evo }) });
  }
  for (const c of open) {
    out.push({ id: c.id, kind: "candidate", label: `${c.id} · ${title.get(c.evolution) ?? c.evolution}`, at: c.submittedAt, evolution: c.evolution, state: c.state });
  }
  return { revisions: out };
}

/** Exact artifact-bound file comparison, used by a pinned multi-binding implementation review. */
/** `fromPath`: the file's path on the `from` side when it differs (a fork's `system/x` against the Genome repo's `x`). */
export async function compareExplicitFile(env:Env,from:ResolvedRef,to:ResolvedRef,rawPath:unknown,fromPath?:string):Promise<FileCompare>{
 const path=validPath(rawPath),[a,b]=await Promise.all([readSide(env,from,fromPath??path),readSide(env,to,path)]),binary=a.binary||b.binary;
 return {path,from:binary?{...a.side,text:null}:a.side,to:binary?{...b.side,text:null}:b.side,truncated:a.truncated||b.truncated,binary};
}
