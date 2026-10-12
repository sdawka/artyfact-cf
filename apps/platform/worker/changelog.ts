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
type CachedEntry = Omit<ChangelogEntry, "row"> & { row: CachedRow };

/** Builds and the deployment of a System commit. Empty until build and deployment records exist (slice B3). */
async function liveFields(_env: Env, _systemId: string, _commit: SystemCommit): Promise<LiveFields> {
  return { builds: [] as BuildSummary[], deployment: null as Deployment | null };
}

async function candidatesOf(stub: SystemApi, c: SystemCommit): Promise<ChangelogRow["candidates"]> {
  return Promise.all(c.candidates.map(async (id) => {
    const cand = await stub.candidate(id);
    const rec = cand ? await stub.realization(cand.realization) : null;
    return { id, realization: cand?.realization ?? "", commit: cand?.commit ?? "", repo: rec?.forkRepo ?? "", agent: rec?.realization.agent.id ?? "" };
  }));
}

function rowOf(c: SystemCommit, cmp: SystemCompare, titles: Map<string, string>, candidates: ChangelogRow["candidates"]): CachedRow {
  const d = cmp.genome.delta;
  const files = cmp.app?.files;
  return {
    id: c.id, parent: c.parent, at: c.decision.at || c.createdAt || "", by: c.decision.by, policy: c.decision.policy, rationale: c.decision.rationale,
    kind: commitKind(c),
    evolutions: c.evolutions.map((id) => ({ id, title: titles.get(id) ?? id })),
    candidates, genomeCommit: c.genomeCommit,
    summary: {
      nodesAdded: d?.added.length ?? 0, nodesChanged: d?.changed.length ?? 0, nodesRemoved: d?.removed.length ?? 0,
      filesChanged: files ? files.added.length + files.modified.length + files.removed.length : 0,
      criteriaAffected: d?.affectedCriteria.length ?? 0,
    },
    manifestHash: c.manifestHash ?? null,
    platform: c.composition?.platform ?? null,
    ...(c.decision.evidenceProviders?.includes("fake") && { fakeProvider: true }),
  };
}

const evalTime = (e: Evaluation) => e.finishedAt ?? e.startedAt ?? "";

async function evaluationsIn(stub: SystemApi, candidateIds: string[]): Promise<Evaluation[]> {
  return (await Promise.all(candidateIds.map((id) => stub.evaluations(id)))).flat();
}

/**
 * Per criterion, the folded verdict before (evidence promoted up to the parent) and after (up to this commit), for
 * the criteria this commit's delta affects or its candidates evaluated. `evaluation` is the latest row of this
 * commit's own candidates for that criterion.
 */
async function criteriaOf(env: Env, head: HeadState, c: SystemCommit, cmp: SystemCompare, repo: string): Promise<ChangelogEntry["criteria"]> {
  const stub = systemStub(env, head.systemId);
  const [beforeIds, afterIds] = await Promise.all([c.parent ? stub.promotedCandidates(c.parent) : [], stub.promotedCandidates(c.id)]);
  const [before, after] = await Promise.all([evaluationsIn(stub, beforeIds), evaluationsIn(stub, afterIds)]);
  const own = new Set(c.candidates);
  let hooks: { id: string; triggers?: readonly string[] }[] = [];
  try {
    hooks = (await genomeAt(env, head.systemId, c.genomeCommit, repo)).model.hooks;
  } catch {
    // A Genome that does not load counts every not-run row (the stricter fold).
  }
  const off = offTriggerHookIds(hooks);
  const ids = [...new Set([...(cmp.genome.delta?.affectedCriteria ?? []), ...after.filter((e) => own.has(e.candidate)).map((e) => e.criterion)])].sort();
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

/** Compute a commit's entry (against its parent; the root import against nothing) and cache row + entry. */
async function computeEntry(env: Env, head: HeadState, c: SystemCommit): Promise<CachedEntry> {
  const stub = systemStub(env, head.systemId);
  const parent = c.parent ? await stub.systemCommit(c.parent) : null;
  const [from, to] = await Promise.all([parent ? sideOfCommit(env, head, parent) : null, sideOfCommit(env, head, c)]);
  const cmp = await compareSystem(env, head, from, to);
  const [evolutions, candidates, criteria] = await Promise.all([
    stub.evolutions(), candidatesOf(stub, c), criteriaOf(env, head, c, cmp, to.genome.repo),
  ]);
  const row = rowOf(c, cmp, new Map(evolutions.map((e) => [e.id, e.title] as const)), candidates);
  const entry: CachedEntry = { ...cmp, row, decision: c.decision, criteria, codeLinks: codeLinksOf(cmp) };
  await stub.putChangelog(c.id, JSON.stringify(row), JSON.stringify(entry));
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
  const cached = await stub.changelogCached(c.id);
  const entry = cached?.entry ? (JSON.parse(cached.entry) as CachedEntry) : await computeEntry(env, head, c);
  return { ...entry, row: { ...entry.row, ...(await liveFields(env, systemId, c)) } };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return CHANGELOG_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw badRequest("limit must be a positive integer");
  return Math.min(n, CHANGELOG_MAX_LIMIT);
}

/** `GET …/changelog?limit=&before=`: rows newest first; `before` (a System commit id or `sc-N`) pages back. */
export async function changelog(env: Env, systemId: string, q: { limit?: string; before?: string } = {}): Promise<ChangelogResponse> {
  const limit = parseLimit(q.limit);
  const head = await headStateOf(env, systemId);
  const stub = systemStub(env, systemId);
  const history = await stub.history();
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
  const rows = await Promise.all(page.map(async (c) => {
    const row = cached[c.id] ? (JSON.parse(cached[c.id]!) as CachedRow) : (await computeEntry(env, head, c)).row;
    return { ...row, ...(await liveFields(env, systemId, c)) } as ChangelogRow;
  }));
  return { rows, ...(start + limit < history.length && page.length && { nextBefore: page.at(-1)!.id }) };
}
