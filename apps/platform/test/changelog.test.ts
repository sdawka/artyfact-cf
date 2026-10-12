import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, ChangelogEntry, ChangelogResponse, FileCompare, GenomeCompare, HistoryResponse, RevisionsResponse, SystemCompare,
} from "../shared/api";
import { routes } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { clearGenomeMemo } from "../worker/artifacts/genome-source";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { appFiles } from "./fixtures/genome";
import { call as apiCall, genomeAmendment, importFresh, passing, promoteApp, renameContactAndScreen, type Flow } from "./helpers/flows";

beforeEach(() => setHooks({ runner: () => passing }));
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

/** `routes.*` builders return `/api/...`; the flow helper prefixes `/api` itself. */
const get = <T>(path: string) => apiCall<T>("GET", path.replace(/^\/api/, ""));

/** import (sc-1) → app promotion (sc-2) → Genome acceptance (sc-3). */
async function threeCommits() {
  const f = await importFresh();
  const p = await promoteApp(f, { "src/ui/people/list.ts": "list" });
  const g = await genomeAmendment(f, renameContactAndScreen("Contact v2"));
  return { f, p, g };
}

const repoCalls = (f: Flow) => [...f.ns.repos.values()].reduce((n, r) => n + r.calls.length, 0);
const resetCalls = (f: Flow) => { for (const r of f.ns.repos.values()) r.calls.length = 0; };

describe("GET …/changelog", () => {
  it("lists light rows newest first with kinds, summary counts and pagination", async () => {
    const { f, p, g } = await threeCommits();
    const first = await get<ChangelogResponse>(routes.changelog(f.systemId, { limit: 2 }));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json.rows.map((r) => [r.id, r.kind])).toEqual([[g.systemCommit!.id, "acceptance"], [p.systemCommit.id, "promotion"]]);
    expect(first.json.nextBefore).toBe(p.systemCommit.id);
    const rest = await get<ChangelogResponse>(routes.changelog(f.systemId, { limit: 2, before: first.json.nextBefore }));
    expect(rest.json.rows.map((r) => [r.id, r.kind, r.parent])).toEqual([[f.imp.head, "import", null]]);
    expect(rest.json.nextBefore).toBeUndefined();
    // `sc-N` works as `before` too.
    expect((await get<ChangelogResponse>(routes.changelog(f.systemId, { before: "sc-3" }))).json.rows.map((r) => r.id)).toEqual([p.systemCommit.id, f.imp.head]);

    const [acc, promo] = first.json.rows;
    const root = rest.json.rows[0]!;
    expect(promo).toMatchObject({
      parent: f.imp.head, by: "admin", policy: "admin", rationale: "ship it", genomeCommit: f.imp.genomeCommit,
      evolutions: [{ id: "evolution.1", title: "List people" }],
      candidates: [{ id: p.candidate, realization: p.rid, commit: p.commit, repo: p.forkRepo, agent: "claude" }],
      summary: { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, filesChanged: 1, criteriaAffected: 0 },
      manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/), platform: null, builds: [], deployment: null,
    });
    expect(acc).toMatchObject({
      policy: "admin-accept", genomeCommit: g.commit, candidates: [{ id: g.candidate, repo: g.forkRepo }],
      summary: { nodesAdded: 0, nodesChanged: 2, nodesRemoved: 0, filesChanged: 0 },
    });
    expect(acc!.summary.criteriaAffected).toBeGreaterThanOrEqual(2);
    expect(root.summary.filesChanged).toBe(Object.keys(appFiles).length);
    expect(root.summary.nodesAdded).toBeGreaterThan(5);
    expect(root.candidates).toEqual([]);
  });

  it("is 400 for a bad limit or before and 404 for an unknown before", async () => {
    const f = await importFresh();
    for (const q of ["limit=0", "limit=x", "limit=1.5", "before=HEAD"]) {
      expect((await apiCall<ApiError>("GET", `/systems/${f.systemId}/changelog?${q}`)).status, q).toBe(400);
    }
    expect((await apiCall<ApiError>("GET", `/systems/${f.systemId}/changelog?before=sc-9`)).status).toBe(404);
    expect((await get<ChangelogResponse>(routes.changelog(f.systemId, { limit: 500 }))).json.rows).toHaveLength(1);
  });

  it("keeps /history as an alias of the commit list", async () => {
    const { f } = await threeCommits();
    const h = await get<HistoryResponse>(routes.history(f.systemId));
    expect(h.json.commits.map((c) => c.id)).toEqual((await get<ChangelogResponse>(routes.changelog(f.systemId))).json.rows.map((r) => r.id));
  });
});

describe("GET …/changelog/:commitId", () => {
  it("a promotion: the commit against its parent with decision, criteria before/after and code links", async () => {
    const { f, p } = await threeCommits();
    const e = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-2"));
    expect(e.status, JSON.stringify(e.json)).toBe(200);
    expect(e.json.row).toMatchObject({ id: p.systemCommit.id, kind: "promotion", builds: [], deployment: null });
    expect(e.json.from!.id).toBe(f.imp.head);
    expect(e.json.to.id).toBe(p.systemCommit.id);
    expect(e.json.decision).toMatchObject({ by: "admin", rationale: "ship it" });
    expect(e.json.genome.delta).toBeNull();
    expect(e.json.codeLinks).toEqual([{
      path: "src/ui/people/list.ts", repo: p.forkRepo, commit: p.commit, status: "added",
      nodes: expect.arrayContaining(["screen.people", "component.AddContactDialog"]),
    }]);
    const list = e.json.criteria.find((c) => c.id === "C.people.list");
    expect(list).toEqual({ id: "C.people.list", before: "not-run", after: "pass", evaluation: expect.stringContaining(p.candidate) });
    expect(e.json.criteria.find((c) => c.id === "C.system.promotion")).toMatchObject({ before: "not-run", after: "pass" });
  });

  it("an acceptance: the Genome delta, unchanged app, criteria from the amendment's candidate", async () => {
    const { f, g } = await threeCommits();
    const e = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, g.systemCommit!.id));
    expect(e.json.row.kind).toBe("acceptance");
    expect(e.json.genome.delta!.changed.map((c) => [c.id, c.fields])).toEqual([["entity.ContactRecord", ["name"]], ["screen.people", ["name"]]]);
    expect(e.json.codeLinks).toEqual([]);
    expect(e.json.criteria.map((c) => c.id)).toEqual(expect.arrayContaining(["C.people.list", "C.people.sorted"]));
    // Evidence from the earlier app promotion still counts before and after.
    expect(e.json.criteria.find((c) => c.id === "C.people.list")).toMatchObject({ before: "pass", after: "pass" });
  });

  it("the root import compares against nothing (added only); head names the newest commit", async () => {
    const { f, g } = await threeCommits();
    const root = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-1"));
    expect(root.json).toMatchObject({ from: null, row: { kind: "import", parent: null }, genome: { from: null, to: f.imp.genomeCommit } });
    expect(root.json.genome.delta!.removed).toEqual([]);
    expect(root.json.genome.delta!.added).toContain("screen.people");
    expect(root.json.codeLinks.every((l) => l.status === "added" && l.repo === f.appRepo)).toBe(true);
    expect(root.json.codeLinks.map((l) => l.path)).toEqual(Object.keys(appFiles).sort());
    expect((await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "head"))).json.row.id).toBe(g.systemCommit!.id);
  });

  it("is computed once: a second read of the entry and the list touches no repo", async () => {
    const { f } = await threeCommits();
    const first = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-2"));
    await get<ChangelogResponse>(routes.changelog(f.systemId));
    clearGenomeMemo();
    resetCalls(f);
    const again = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-2"));
    expect(again.json).toEqual(first.json);
    await get<ChangelogResponse>(routes.changelog(f.systemId));
    for (const id of ["sc-1", "sc-3"]) await get<ChangelogEntry>(routes.changelogEntry(f.systemId, id));
    expect(repoCalls(f)).toBe(0);
  });

  it("is 404 for an unknown commit and 400 for a malformed id", async () => {
    const f = await importFresh();
    expect((await apiCall<ApiError>("GET", `/systems/${f.systemId}/changelog/sc-5`)).status).toBe(404);
    expect((await apiCall<ApiError>("GET", `/systems/${f.systemId}/changelog/${"a".repeat(40)}`)).status).toBe(400);
    expect((await apiCall<ApiError>("GET", `/systems/${f.systemId}/changelog/main`)).status).toBe(400);
  });
});

describe("compare and revisions routes", () => {
  it("serve System, Genome and file compares and the revision list", async () => {
    const { f, p, g } = await threeCommits();
    const sys = await get<SystemCompare>(routes.compareSystem(f.systemId, undefined, "sc-2"));
    expect(sys.status).toBe(200);
    expect(sys.json.from!.id).toBe(f.imp.head);
    expect(sys.json.app!.files.added).toEqual(["src/ui/people/list.ts"]);
    const whole = await get<SystemCompare>(routes.compareSystem(f.systemId, "sc-1", "head"));
    expect(whole.json.genome.delta!.changed.map((c) => c.id)).toEqual(["entity.ContactRecord", "screen.people"]);
    expect(whole.json.app!.files.added).toEqual(["src/ui/people/list.ts"]);

    const gen = await get<GenomeCompare>(routes.compareGenome(f.systemId, "sc-2", "head"));
    expect(gen.json).toMatchObject({ from: { commit: f.imp.genomeCommit }, to: { commit: g.commit, repo: g.forkRepo }, files: { modified: ["things/webapp/ontology.yaml"] } });

    const file = await get<FileCompare>(routes.compareFile(f.systemId, "app", "sc-1", p.candidate, "src/ui/people/list.ts"));
    expect(file.json).toMatchObject({ path: "src/ui/people/list.ts", from: { hash: null }, to: { text: "list", candidate: p.candidate }, truncated: false, binary: false });

    const rev = await get<RevisionsResponse>(routes.revisions(f.systemId));
    expect(rev.json.revisions.map((r) => r.id)).toEqual(["head", g.systemCommit!.id, p.systemCommit.id, f.imp.head]);
  });

  it("answer 404 for unknown refs and 400 for malformed refs, scopes and paths", async () => {
    const f = await importFresh();
    const s = f.systemId;
    const status = async (path: string) => (await get<ApiError>(path)).status;
    expect(await status(routes.compareSystem(s, "sc-4", "head"))).toBe(404);
    expect(await status(routes.compareGenome(s, undefined, "f".repeat(40)))).toBe(404);
    expect(await status(routes.compareSystem(s, "HEAD~1", "head"))).toBe(400);
    expect(await status(`/api/systems/${s}/compare/file?scope=web&to=head&path=a`)).toBe(400);
    expect(await status(`/api/systems/${s}/compare/file?scope=app&to=head&path=../x`)).toBe(400);
    expect(await status(`/api/systems/${s}/compare/file?scope=app&to=head`)).toBe(400);
    expect(await status(routes.revisions("system.never-imported"))).toBe(404);
  });
});
