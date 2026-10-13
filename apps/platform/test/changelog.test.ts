import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiError, ChangelogEntry, ChangelogResponse, FileCompare, GenomeCompare, HistoryResponse, RevisionsResponse, SystemCompare,
} from "../shared/api";
import { routes } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { clearGenomeMemo } from "../worker/artifacts/genome-source";
import type { SystemAuthority } from "../worker/do/system-authority";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { FILE_COMPARE_MAX_BYTES, compareFile } from "../worker/compare";
import { appFiles, genomeFiles, genomeFor } from "./fixtures/genome";
import { LegacyGenomeError } from "@artyfact/model";
import { ADMIN, call as apiCall, genomeAmendment, importFresh, passing, promoteApp, renameContactAndScreen, type Flow } from "./helpers/flows";

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
      manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/), platform: null, builds: [],
      // Without CI a promotion leaves a pending production deployment bound to its System commit.
      deployment: { kind: "production", status: "pending", systemCommit: p.systemCommit.id, commit: p.commit },
    });
    expect(acc).toMatchObject({
      policy: "admin-accept", genomeCommit: g.commit, candidates: [{ id: g.candidate, repo: g.forkRepo }],
      // The Genome amendment's two changed node files count.
      summary: { nodesAdded: 0, nodesChanged: 2, nodesRemoved: 0, filesChanged: 2 },
    });
    expect(acc!.summary.criteriaAffected).toBeGreaterThanOrEqual(2);
    // The app's files and the Genome repo's (its fixture files plus the flow's extra Evolutions).
    expect(root.summary.filesChanged).toBeGreaterThanOrEqual(Object.keys(appFiles).length + Object.keys(genomeFiles).length);
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
    expect(e.json.row).toMatchObject({ id: p.systemCommit.id, kind: "promotion", builds: [], deployment: { status: "pending", systemCommit: p.systemCommit.id } });
    expect(e.json.from!.id).toBe(f.imp.head);
    expect(e.json.to.id).toBe(p.systemCommit.id);
    expect(e.json.decision).toMatchObject({ by: "admin", rationale: "ship it" });
    expect(e.json.genome.delta).toBeNull();
    expect(e.json.codeLinks).toEqual([{
      scope: "app", path: "src/ui/people/list.ts", repo: p.forkRepo, commit: p.commit, status: "added",
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
    // The app is unchanged; the Genome files that declare the changed nodes link to the accepted fork.
    expect(e.json.genome.files).toEqual({ added: [], modified: ["thing.webapp/section.domain/entity.ContactRecord/node.yaml", "thing.webapp/section.ui/screen.people/node.yaml"], removed: [] });
    expect(e.json.codeLinks).toEqual([
      { scope: "genome", path: "thing.webapp/section.domain/entity.ContactRecord/node.yaml", repo: g.forkRepo, commit: g.commit, status: "modified", nodes: ["entity.ContactRecord"] },
      { scope: "genome", path: "thing.webapp/section.ui/screen.people/node.yaml", repo: g.forkRepo, commit: g.commit, status: "modified", nodes: ["screen.people"] },
    ]);
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
    expect(root.json.codeLinks.every((l) => l.status === "added")).toBe(true);
    const app = root.json.codeLinks.filter((l) => l.scope === "app");
    expect(app.every((l) => l.repo === f.appRepo)).toBe(true);
    expect(app.map((l) => l.path)).toEqual(Object.keys(appFiles).sort());
    const genome = root.json.codeLinks.filter((l) => l.scope === "genome");
    expect(genome.map((l) => l.path)).toEqual(expect.arrayContaining(Object.keys(genomeFiles)));
    expect(genome.every((l) => l.repo === f.genomeRepo && l.commit === f.imp.genomeCommit)).toBe(true);
    expect(root.json.row.summary.filesChanged).toBe(root.json.codeLinks.length);
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

describe("changelog cache soundness", () => {
  it("does not cache an entry whose Genome failed to load; the next read recomputes and then caches", async () => {
    const { f, g } = await threeCommits();
    // Drop the DO's cached Genomes and make the accepted fork unreadable for one entry computation.
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (_i: SystemAuthority, state) => { state.storage.sql.exec("DELETE FROM model_cache"); });
    clearGenomeMemo();
    const fork = f.ns.repo(g.forkRepo);
    const readCommit = fork.readCommit.bind(fork);
    fork.readCommit = async () => { throw new Error("transient Artifacts failure"); };
    const degraded = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-3"));
    expect(degraded.status, JSON.stringify(degraded.json)).toBe(200);
    expect(degraded.json.genome).toMatchObject({ delta: null, loadError: expect.stringContaining("transient") });
    fork.readCommit = readCommit;
    const fresh = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-3"));
    expect(fresh.json.genome.loadError).toBeUndefined();
    expect(fresh.json.genome.delta!.changed.map((c) => c.id)).toEqual(["entity.ContactRecord", "screen.people"]);
    expect(fresh.json.row.summary.nodesChanged).toBe(2);
    // Sound now, so cached: a third read touches no repo.
    clearGenomeMemo();
    resetCalls(f);
    await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-3"));
    expect(repoCalls(f)).toBe(0);
  });

  it("ignores rows cached under an older cache version and recomputes them", async () => {
    const { f, g } = await threeCommits();
    await get<ChangelogResponse>(routes.changelog(f.systemId));
    // A row cached before Genome files were counted: no version, zero files, no code links.
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (_i: SystemAuthority, state) => {
      const r = state.storage.sql.exec("SELECT row_json, entry_json FROM changelog_cache WHERE commit_id = ?", g.systemCommit!.id).one();
      const row = { ...JSON.parse(String(r.row_json)), summary: { ...JSON.parse(String(r.row_json)).summary, filesChanged: 0 } };
      const entry = { ...JSON.parse(String(r.entry_json)), row, codeLinks: [] };
      state.storage.sql.exec("UPDATE changelog_cache SET row_json = ?, entry_json = ?, version = NULL WHERE commit_id = ?", JSON.stringify(row), JSON.stringify(entry), g.systemCommit!.id);
    });
    const rows = (await get<ChangelogResponse>(routes.changelog(f.systemId))).json.rows;
    expect(rows[0]!.summary.filesChanged).toBe(2);
    const e = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, g.systemCommit!.id));
    expect(e.json.codeLinks.map((l) => [l.scope, l.path])).toEqual([["genome", "thing.webapp/section.domain/entity.ContactRecord/node.yaml"], ["genome", "thing.webapp/section.ui/screen.people/node.yaml"]]);
  });

  it("folds criteria on every read, so evaluations recorded after the commit show", async () => {
    const { f, p } = await threeCommits();
    const first = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-2"));
    expect(first.json.criteria.find((c) => c.id === "C.people.list")!.after).toBe("pass");
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (i: SystemAuthority) => {
      const later = new Date(Date.now() + 60_000).toISOString();
      i.recordEvaluations(p.candidate, [{
        id: `${p.candidate}:hook:C.people.list`, candidate: p.candidate, hook: "hook:C.people.list", criterion: "C.people.list", ownerId: "o", subjectId: "s",
        targetRef: p.commit, execution: "completed", verdict: "fail", verifier: "artyfact-platform", startedAt: later, finishedAt: later, observations: [], limitations: [], provenance: {},
      }]);
    });
    resetCalls(f);
    const again = await get<ChangelogEntry>(routes.changelogEntry(f.systemId, "sc-2"));
    expect(again.json.criteria.find((c) => c.id === "C.people.list")!.after).toBe("fail");
    expect(repoCalls(f)).toBe(0);
  });

  it("serves a degraded row for a commit that cannot be computed instead of failing the page, and retries it later", async () => {
    const { f, p, g } = await threeCommits();
    const fork = f.ns.repos.get(p.forkRepo)!;
    f.ns.repos.delete(p.forkRepo);
    const page = await get<ChangelogResponse>(routes.changelog(f.systemId));
    expect(page.status, JSON.stringify(page.json)).toBe(200);
    expect(page.json.rows.map((r) => r.id)).toEqual([g.systemCommit!.id, p.systemCommit.id, f.imp.head]);
    expect(page.json.rows[1]).toMatchObject({ kind: "promotion", rationale: "ship it", summary: { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, filesChanged: 0, criteriaAffected: 0 }, loadError: expect.stringContaining(p.forkRepo) });
    expect(page.json.rows[0]!.loadError).toBeUndefined();
    f.ns.repos.set(p.forkRepo, fork);
    const retried = await get<ChangelogResponse>(routes.changelog(f.systemId));
    expect(retried.json.rows[1]!.summary.filesChanged).toBe(1);
    expect(retried.json.rows[1]!.loadError).toBeUndefined();
  });

  it("serves current Evolution titles over the ones cached with the row", async () => {
    const { f } = await threeCommits();
    await get<ChangelogResponse>(routes.changelog(f.systemId));
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (_i: SystemAuthority, state) => {
      state.storage.sql.exec("UPDATE evolutions SET title = 'People list v2' WHERE id = 'evolution.1'");
    });
    const rows = (await get<ChangelogResponse>(routes.changelog(f.systemId))).json.rows;
    expect(rows.find((r) => r.kind === "promotion")!.evolutions).toEqual([{ id: "evolution.1", title: "People list v2" }]);
  });
});

const LEGACY_MESSAGE = "this revision predates the node-tree Genome format; convert it with `artyfact convert-genome` and push it with `artyfact init --adopt --force` (docs/deploy.md)";

describe("a Genome in the retired v1 layout", () => {
  /** import (sc-1) → a Genome acceptance whose tree is in the v1 layout (sc-2), accepted in the DO without loading it. */
  async function legacyHead() {
    const f = await importFresh();
    const g = await genomeAmendment(f, (files) => {
      files.clear();
      files.set("system.yaml", `id: ${f.systemId}\nname: Old\n`).set("kits.yaml", "kits: []\n");
    }, { accept: false });
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (i: SystemAuthority) => {
      const at = new Date().toISOString();
      i.recordEvaluations(g.candidate, [{
        id: "", candidate: g.candidate, criterion: "C.legacy", hook: "hook.legacy", verdict: "pass", execution: "completed", observations: [], verifier: "test",
        ownerId: "system", subjectId: f.systemId, targetRef: g.candidate, startedAt: at, finishedAt: at, limitations: [], provenance: {},
      }], "awaiting-admin");
      const gates = [{ id: "C.legacy", severity: "hard" as const, blocking: true }];
      const out = await i.accept({ realizationId: g.rid, candidateId: g.candidate, commit: g.commit, rationale: "legacy", by: "admin", evolutions: [], gates, artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {} });
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    });
    return { f, g };
  }

  it("answers 422 legacy-genome on the model and readiness routes", async () => {
    const { f } = await legacyHead();
    for (const path of [routes.model(f.systemId), routes.readiness(f.systemId)]) {
      const r = await get<ApiError>(path);
      expect(r.status, JSON.stringify(r.json)).toBe(422);
      expect(r.json.error).toMatchObject({ code: "legacy-genome", message: LEGACY_MESSAGE });
    }
  });

  it("names the converter in its error, and a forced re-import of a converted tree on the same repo restores the head", async () => {
    expect(new LegacyGenomeError().message).toBe(LEGACY_MESSAGE);
    const { f } = await legacyHead();
    // What `artyfact init --adopt --force` does with the converted tree: a new commit on the Genome repo, then a forced import.
    const v2 = f.ns.repo(f.genomeRepo).commit(genomeFor(f.systemId), "Convert the Genome to the node tree");
    const plain = await apiCall<ApiError>("POST", "/systems/import", { systemId: f.systemId, genomeRepo: f.genomeRepo, appRepo: f.appRepo }, ADMIN);
    expect(plain.status).toBe(409);
    expect(plain.json.error.code).toBe("already-imported");
    const forced = await apiCall<{ genomeCommit: string }>("POST", "/systems/import", { systemId: f.systemId, genomeRepo: f.genomeRepo, appRepo: f.appRepo, force: true }, ADMIN);
    expect(forced.status, JSON.stringify(forced.json)).toBe(201);
    expect(forced.json.genomeCommit).toBe(v2);
    for (const path of [routes.model(f.systemId), routes.readiness(f.systemId)]) expect((await get<unknown>(path)).status).toBe(200);
  });

  it("ignores model, readiness and changelog rows cached before the v2 projection", async () => {
    const { f, g } = await legacyHead();
    await get<ChangelogResponse>(routes.changelog(f.systemId));
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (_i: SystemAuthority, state) => {
      // What the previous release cached: v1-built parts under their bare names, and changelog rows without legacyFormat.
      const at = new Date().toISOString();
      for (const part of ["model", "rules"]) {
        state.storage.sql.exec("INSERT OR REPLACE INTO model_cache (genome_commit, part, json, created_at) VALUES (?, ?, ?, ?)", g.commit, part, JSON.stringify({ findings: [] }), at);
      }
      state.storage.sql.exec("UPDATE changelog_cache SET version = 2, row_json = json_remove(row_json, '$.legacyFormat')");
    });
    for (const path of [routes.model(f.systemId), routes.readiness(f.systemId)]) {
      const r = await get<ApiError>(path);
      expect(r.status, JSON.stringify(r.json)).toBe(422);
      expect(r.json.error.code).toBe("legacy-genome");
    }
    expect((await get<ChangelogResponse>(routes.changelog(f.systemId))).json.rows[0]).toMatchObject({ genomeCommit: g.commit, legacyFormat: true });
  });

  it("marks the changelog row and both compares legacyFormat, with no delta", async () => {
    const { f, g } = await legacyHead();
    const rows = (await get<ChangelogResponse>(routes.changelog(f.systemId))).json.rows;
    expect(rows[0]).toMatchObject({ genomeCommit: g.commit, legacyFormat: true, summary: { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0 } });
    expect(rows[0]!.loadError).toBeUndefined();
    expect(rows.at(-1)!.legacyFormat).toBeUndefined();
    const sys = await get<SystemCompare>(routes.compareSystem(f.systemId, "sc-1", "head"));
    expect(sys.json.genome).toMatchObject({ delta: null, legacyFormat: ["to"] });
    expect(sys.json.genome.loadError).toBeUndefined();
    const gen = await get<GenomeCompare>(routes.compareGenome(f.systemId, "head", "sc-1"));
    expect(gen.json).toMatchObject({ delta: null, legacyFormat: ["from"] });
  });
});

describe("file compare truncation", () => {
  it("cuts on a UTF-8 boundary, never leaving a replacement character", async () => {
    const f = await importFresh();
    // 3-byte characters after one ASCII byte: the 512 KB cut falls inside a character.
    const text = `a${"€".repeat(200_000)}`;
    await promoteApp(f, { "notes/euro.txt": text });
    const cmp = await compareFile(env, f.systemId, "app", "sc-1", "sc-2", "notes/euro.txt");
    expect(cmp.truncated).toBe(true);
    expect(cmp.to.text!.endsWith("\uFFFD")).toBe(false);
    expect(new TextEncoder().encode(cmp.to.text!).length).toBeLessThanOrEqual(FILE_COMPARE_MAX_BYTES);
    expect(cmp.to.text!.length).toBe(1 + Math.floor((FILE_COMPARE_MAX_BYTES - 1) / 3));
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
    expect(gen.json).toMatchObject({ from: { commit: f.imp.genomeCommit }, to: { commit: g.commit, repo: g.forkRepo }, files: { modified: ["thing.webapp/section.domain/entity.ContactRecord/node.yaml", "thing.webapp/section.ui/screen.people/node.yaml"] } });

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
