/**
 * The Changelog: every System commit as a light row (list) or a full entry (the commit against its parent with its
 * decision, criteria before/after and code links). Both are computed once per commit and cached in the DO, since
 * System commits are immutable. Builds and the deployment are attached at read time (they change after the commit).
 */
import type { BuildSummary, ChangelogEntry, ChangelogResponse, ChangelogRow, Deployment, Evaluation, SystemCommit, SystemCompare, Verdict } from "../shared/api";
import { foldVerdict, offTriggerHookIds } from "../shared/verdict";
import { compareSystem, commitKind, findSystemCommit, headStateOf, sideOfCommit } from "./compare";
import type { HeadState } from "./do/system-authority";
import { badRequest, notFound } from "./errors";
import { genomeAt, systemStub, type SystemApi } from "./service";

export const CHANGELOG_DEFAULT_LIMIT = 20;
export const CHANGELOG_MAX_LIMIT = 100;

/** Row fields that change after the commit (builds, deployment); filled at read time, never cached. */
type LiveFields = Pick<ChangelogRow, "builds" | "deployment">;
type CachedRow = Omit<ChangelogRow, keyof LiveFields>;
/**
 * What is cached per commit. Criteria verdicts are not: they fold mutable evaluation rows, so only the criterion ids
 * and the off-trigger hook ids are kept and the fold runs on every read (DO reads only).
 */
type CachedEntry = Omit<ChangelogEntry, "row" | "criteria"> & { row: CachedRow; criteriaIds: string[]; offTriggerHooks: string[] };
type Titles = Map<string, string>;

/** Builds and the deployment of a System commit. Empty until build and deployment records exist (slice B3). */
async function liveFields(_env: Env, _systemId: string, _commit: SystemCommit): Promise<LiveFields> {
  return { builds: [] as BuildSummary[], deployment: null as Deployment | null };
}

async function titlesOf(stub: SystemApi): Promise<Titles> {
  return new Map((await stub.evolutions()).map((e) => [e.id, e.title] as const));
}

/** The row as served: current Evolution titles and the live fields. */
async function serveRow(env: Env, systemId: string, c: SystemCommit, row: CachedRow, titles: Titles): Promise<ChangelogRow> {
  return { ...row, evolutions: row.evolutions.map((e) => ({ id: e.id, title: titles.get(e.id) ?? e.title })), ...(await liveFields(env, systemId, c)) };
}

/** This commit's candidates; `degraded` when a candidate or its realization is missing (never cached then). */
async function candidatesOf(stub: SystemApi, c: SystemCommit): Promise<{ candidates: ChangelogRow["candidates"]; degraded: boolean }> {
  let degraded = false;
  const candidates = await Promise.all(c.candidates.map(async (id) => {
    const cand = await stub.candidate(id);
    const rec = cand ? await stub.realization(cand.realization) : null;
    if (!cand || !rec) degraded = true;
    return { id, realization: cand?.realization ?? "unknown", commit: cand?.commit ?? "unknown", repo: rec?.forkRepo ?? "unknown", agent: rec?.realization.agent.id ?? "unknown" };
  }));
  return { candidates, degraded };
}

const ZERO = { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, filesChanged: 0, criteriaAffected: 0 };

function baseRow(c: SystemCommit, titles: Titles, candidates: ChangelogRow["candidates"]): CachedRow {
  return {
    id: c.id, parent: c.parent, at: c.decision.at || c.createdAt || "", by: c.decision.by, policy: c.decision.policy, rationale: c.decision.rationale,
    kind: commitKind(c),
    evolutions: c.evolutions.map((id) => ({ id, title: titles.get(id) ?? id })),
    candidates, genomeCommit: c.genomeCommit, summary: { ...ZERO },
    manifestHash: c.manifestHash ?? null,
    platform: c.composition?.platform ?? null,
    ...(c.decision.evidenceProviders?.includes("fake") && { fakeProvider: true }),
  };
}

function rowOf(c: SystemCommit, cmp: SystemCompare, titles: Titles, candidates: ChangelogRow["candidates"]): CachedRow {
  const d = cmp.genome.delta;
  const files = cmp.app?.files;
  return {
    ...baseRow(c, titles, candidates),
    summary: {
      nodesAdded: d?.added.length ?? 0, nodesChanged: d?.changed.length ?? 0, nodesRemoved: d?.removed.length ?? 0,
      filesChanged: files ? files.added.length + files.modified.length + files.removed.length : 0,
      criteriaAffected: d?.affectedCriteria.length ?? 0,
    },
  };
}

const evalTime = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

async function evaluationsIn(stub: SystemApi, candidateIds: string[]): Promise<Evaluation[]> {
  return (await Promise.all(candidateIds.map((id) => stub.evaluations(id)))).flat();
}

/**
 * Per criterion, the folded verdict before (evidence promoted up to the parent) and after (up to this commit).
 * `evaluation` is the latest row of this commit's own candidates for that criterion. Folded on every read.
 */
async function foldCriteria(env: Env, systemId: string, c: SystemCommit, criteriaIds: string[], offTriggerHooks: string[]): Promise<ChangelogEntry["criteria"]> {
  const stub = systemStub(env, systemId);
  const [beforeIds, afterIds] = await Promise.all([c.parent ? stub.promotedCandidates(c.parent) : [], stub.promotedCandidates(c.id)]);
  const [before, after] = await Promise.all([evaluationsIn(stub, beforeIds), evaluationsIn(stub, afterIds)]);
  const own = new Set(c.candidates);
  const off = new Set(offTriggerHooks);
  const ids = [...new Set([...criteriaIds, ...after.filter((e) => own.has(e.candidate)).map((e) => e.criterion)])].sort();
  const fold = (rows: Evaluation[], id: string) => foldVerdict(rows.filter((e) => e.criterion === id), off) as Verdict | "not-run";
  return ids.map((id) => {
    const latest = after.filter((e) => e.criterion === id && own.has(e.candidate)).sort((a, b) => evalTime(b).localeCompare(evalTime(a)))[0];
    return { id, before: fold(before, id), after: fold(after, id), ...(latest && { evaluation: latest.id }) };
  });
}

function codeLinksOf(cmp: SystemCompare): ChangelogEntry["codeLinks"] {
  const app = cmp.app;
  if (!app) return [];
  const link = (status: "added" | "modified" | "removed") => (path: string) => {
    const side = status === "removed" ? app.from ?? app.to : app.to;
    return { path, repo: side.repo, commit: side.commit, nodes: app.pathNodes[path] ?? [], status };
  };
  return [...app.files.added.map(link("added")), ...app.files.modified.map(link("modified")), ...app.files.removed.map(link("removed"))]
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compute a commit's entry (against its parent; the root import against nothing). It is cached only when sound: a
 * Genome that did not load, a hooks list that could not be read or a missing candidate leaves it uncached, so a
 * transient failure is recomputed on the next read instead of being frozen.
 */
async function computeEntry(env: Env, head: HeadState, c: SystemCommit, titles: Titles): Promise<CachedEntry> {
  const stub = systemStub(env, head.systemId);
  const parent = c.parent ? await stub.systemCommit(c.parent) : null;
  const [from, to] = await Promise.all([parent ? sideOfCommit(env, head, parent) : null, sideOfCommit(env, head, c)]);
  const cmp = await compareSystem(env, head, from, to);
  let hooksLoaded = true;
  const [{ candidates, degraded }, hooks] = await Promise.all([
    candidatesOf(stub, c),
    genomeAt(env, head.systemId, c.genomeCommit, to.genome.repo).then((g) => g.model.hooks, () => {
      hooksLoaded = false; // folded with no off-trigger hooks (the stricter fold) until a read can load them
      return [];
    }),
  ]);
  const entry: CachedEntry = {
    ...cmp, row: rowOf(c, cmp, titles, candidates), decision: c.decision, codeLinks: codeLinksOf(cmp),
    criteriaIds: [...(cmp.genome.delta?.affectedCriteria ?? [])], offTriggerHooks: [...offTriggerHookIds(hooks)].sort(),
  };
  if (!cmp.genome.loadError && hooksLoaded && !degraded) await stub.putChangelog(c.id, JSON.stringify(entry.row), JSON.stringify(entry));
  return entry;
}

const COMMIT_ID_RE = /^sc-\d+(-[0-9a-f]{8})?$/;

/** `GET …/changelog/:commitId`: `head`, `sc-N` or a full System commit id. */
export async function changelogEntry(env: Env, systemId: string, commitId: string): Promise<ChangelogEntry> {
  if (commitId !== "head" && !COMMIT_ID_RE.test(commitId)) throw badRequest("commitId must be head, sc-N or a System commit id");
  const head = await headStateOf(env, systemId);
  const stub = systemStub(env, systemId);
  const c = await findSystemCommit(stub, commitId === "head" ? head.head! : commitId);
  if (!c) throw notFound(`unknown System commit ${commitId}`);
  const [cached, titles] = await Promise.all([stub.changelogCached(c.id), titlesOf(stub)]);
  const { criteriaIds, offTriggerHooks, ...entry } = cached?.entry ? (JSON.parse(cached.entry) as CachedEntry) : await computeEntry(env, head, c, titles);
  const [row, criteria] = await Promise.all([serveRow(env, systemId, c, entry.row, titles), foldCriteria(env, systemId, c, criteriaIds ?? [], offTriggerHooks ?? [])]);
  return { ...entry, row, criteria };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return CHANGELOG_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw badRequest("limit must be a positive integer");
  return Math.min(n, CHANGELOG_MAX_LIMIT);
}

/** Uncached rows computed at once per page. */
export const CHANGELOG_CONCURRENCY = 4;

/** Run `fn` over `items` with at most `n` in flight, keeping order. */
async function mapLimited<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * `GET …/changelog?limit=&before=`: rows newest first; `before` (a System commit id or `sc-N`) pages back. A commit
 * whose entry cannot be computed is served as a degraded row (zero summary counts, not cached) instead of failing the page.
 */
export async function changelog(env: Env, systemId: string, q: { limit?: string; before?: string } = {}): Promise<ChangelogResponse> {
  const limit = parseLimit(q.limit);
  const head = await headStateOf(env, systemId);
  const stub = systemStub(env, systemId);
  const [history, titles] = await Promise.all([stub.history(), titlesOf(stub)]);
  let start = 0;
  if (q.before) {
    if (!COMMIT_ID_RE.test(q.before)) throw badRequest("before must be sc-N or a System commit id");
    const target = await findSystemCommit(stub, q.before);
    const i = target ? history.findIndex((c) => c.id === target.id) : -1;
    if (i < 0) throw notFound(`unknown System commit ${q.before}`);
    start = i + 1;
  }
  const page = history.slice(start, start + limit);
  const cached = await stub.changelogRows(page.map((c) => c.id));
  const rows = await mapLimited(page, CHANGELOG_CONCURRENCY, async (c) => {
    if (cached[c.id]) return serveRow(env, systemId, c, JSON.parse(cached[c.id]!) as CachedRow, titles);
    try {
      return await serveRow(env, systemId, c, (await computeEntry(env, head, c, titles)).row, titles);
    } catch (e) {
      const loadError = (e as Error)?.message ?? String(e);
      console.error(`[changelog] ${systemId} ${c.id}: ${loadError}`);
      return serveRow(env, systemId, c, { ...baseRow(c, titles, (await candidatesOf(stub, c)).candidates), loadError }, titles);
    }
  });
  return { rows, ...(start + limit < history.length && page.length && { nextBefore: page.at(-1)!.id }) };
}
