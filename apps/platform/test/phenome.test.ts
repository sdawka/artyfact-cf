import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { PHENOME_LIMITS, PhenomeEventHeader } from "@artyfact/model";
import { beforeEach, describe, expect, it } from "vitest";
import type { PhenomeEventsResponse, PhenomeIngestResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { REGISTRY, type BootstrapInput, type SystemAuthority } from "../worker/do/system-authority";
import { ingestEvents, ingestPrincipal, resetPhenomeThrottle } from "../worker/phenome";
import { sha256Hex } from "../worker/util";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const ADMIN = { authorization: "Bearer test-admin-token" };
const G1 = "1".repeat(40), A1 = "a".repeat(40), A2 = "b".repeat(40), A3 = "c".repeat(40), FORK_HEAD = "d".repeat(40);
const boot: BootstrapInput = {
  systemId: "system.kit", title: "Kit", genomeRepo: "kit-system", appRepo: "kit-app", genomeCommit: G1, appCommit: A1,
  artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {}, platform: null,
  evolutions: [{
    id: "evolution.1", title: "List people", intent: "x", state: "actionable", kind: "implementation", affectedNodes: ["screen.people"],
    affectedClaims: [], genomeDelta: [], acceptanceCriteria: ["C.people.list"], requiredEvidence: [], dependsOn: [], risk: "low",
  }],
};

let n = 0;
let sys = "";
const stub = () => env.SYSTEMS.getByName(sys);
type Do = SystemAuthority;
const sqlOf = (i: SystemAuthority) => (i as unknown as { sql: SqlStorage }).sql;
const inDo = <T>(f: (i: Do) => T | Promise<T>): Promise<T> => runInDurableObject(stub(), (i: Do) => f(i));

const ev = (over: Record<string, unknown> = {}) => ({
  systemId: sys, thingId: "thing.webapp", artifactId: "artifact.webapp", buildId: A2, commit: A2, emittedAt: new Date().toISOString(),
  kind: "health", payload: { ok: true }, ...over,
});
const post = async (events: unknown[], headers: Record<string, string> = ADMIN, path = sys) => {
  const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${path}/phenome/events`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ events }),
  }));
  return { status: res.status, json: (await res.json()) as PhenomeIngestResponse & { error?: unknown } };
};
const get = async (qs = "") => {
  const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${sys}/phenome/events${qs}`));
  return { status: res.status, json: (await res.json()) as PhenomeEventsResponse };
};

let rid = "";
let secret = "";
let ns: FakeArtifacts;
beforeEach(async () => {
  sys = `phen-${++n}-${Date.now()}`;
  resetPhenomeThrottle();
  ns = new FakeArtifacts();
  setArtifactsOverride(ns);
  secret = `secret-${n}`;
  const hash = await sha256Hex(secret);
  await inDo(async (i) => {
    await i.bootstrap(boot);
    const r = i.reserveRealization({ evolutionId: "evolution.1", target: "app", agentLabel: "a" });
    rid = r.realization.id;
    i.activateRealization(rid, { tokenId: "t", tokenExpires: new Date(Date.now() + 1e6).toISOString(), remote: "x", packet: { hash: "h" } as never, secretHash: hash });
    i.recordCandidate({ realizationId: rid, commit: A2, manifest: {}, changedPaths: [], changedNodes: [] });
    ns.create(r.forkRepo).commit({ "a.txt": "x" }, "head");
    return i.summary()!;
  }).then((summary) => env.SYSTEMS.getByName(REGISTRY).registerSystem({ ...summary, systemId: sys }));
});

/** A deployment row with a known ingest token, created directly (the create route belongs to another slice). */
async function deployment(id: string, commit: string, token: string, realization: string | null = null) {
  const hash = await sha256Hex(token);
  await inDo((i) => {
    const t = new Date().toISOString();
    sqlOf(i).exec(
      "INSERT INTO deployments (id, kind, status, repo, commit_hash, realization_id, by, ingest_token_hash, created_at, updated_at) VALUES (?, 'production', 'live', 'r', ?, ?, 'admin', ?, ?, ?)",
      id, commit, realization, hash, t, t,
    );
  });
}

describe("PhenomeEventHeader", () => {
  it("accepts a full header and omits optional fields", () => {
    expect(PhenomeEventHeader.safeParse(ev()).success).toBe(true);
    expect(PhenomeEventHeader.safeParse(ev({ deploymentId: "", id: "" })).success).toBe(false);
    expect(PhenomeEventHeader.safeParse(ev({ commit: "dev" })).success).toBe(false);
    expect(PhenomeEventHeader.safeParse(ev({ kind: "1bad" })).success).toBe(false);
    expect(PhenomeEventHeader.safeParse(ev({ emittedAt: "yesterday" })).success).toBe(false);
  });
});

describe("POST phenome/events auth", () => {
  it("401 without a bearer, 403 for an unknown token", async () => {
    expect((await post([ev()], {})).status).toBe(401);
    expect((await post([ev()], { authorization: "Bearer nope" })).status).toBe(403);
  });

  it("accepts the admin bearer", async () => {
    const r = await post([ev()]);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ accepted: 1, dropped: [] });
  });

  it("accepts a deployment ingest token for its own build only", async () => {
    await deployment("dep-1", A2, "dep-token");
    const h = { authorization: "Bearer dep-token" };
    const r = await post([ev({ deploymentId: "dep-1" }), ev({ deploymentId: "dep-other", id: "x2" }), ev({ commit: A3, buildId: A3, id: "x3" }), ev({ commit: A2.slice(0, 7), id: "x4" })], h);
    expect(r.json.accepted).toBe(2);
    expect(r.json.dropped).toEqual([{ index: 1, reason: "deployment-mismatch" }, { index: 2, reason: "commit-mismatch" }]);
    const list = await get();
    expect(list.json.events.every((e) => e.deploymentId === "dep-1")).toBe(true);
  });

  it("a deployment's realization is stamped on its events", async () => {
    await deployment("dep-2", A2, "tok2", rid);
    await post([ev()], { authorization: "Bearer tok2" });
    expect((await get(`?realization=${rid}`)).json.events).toHaveLength(1);
  });

  it("realization secret: commit must be a candidate or the fork head", async () => {
    const h = { authorization: `Bearer ${secret}` };
    const r = await post([ev(), ev({ commit: A3, buildId: A3, id: "other" }), ev({ commit: FORK_HEAD, buildId: FORK_HEAD, id: "head" })], h);
    expect(r.json.accepted).toBe(1);
    expect(r.json.dropped).toEqual([{ index: 1, reason: "commit-not-in-realization" }, { index: 2, reason: "commit-not-in-realization" }]);
    const rec = await inDo((i) => i.realization(rid)!);
    const [head] = await ns.repo(rec.forkRepo).log({ limit: 1 });
    const ok = await post([ev({ commit: head.hash, buildId: head.hash, id: "forkhead" })], h);
    expect(ok.json.accepted).toBe(1);
    expect((await get(`?realization=${rid}`)).json.events).toHaveLength(2);
  });

  it("rejects a revoked realization secret", async () => {
    await inDo((i) => sqlOf(i).exec("UPDATE realizations SET secret_hash = NULL"));
    expect((await post([ev()], { authorization: `Bearer ${secret}` })).status).toBe(403);
  });

  it("ingestPrincipal names the principal kind", async () => {
    expect(await ingestPrincipal(env, sys, ADMIN.authorization)).toEqual({ kind: "admin" });
    expect(await ingestPrincipal(env, sys, `Bearer ${secret}`)).toMatchObject({ kind: "realization", id: rid, commits: [A2] });
  });

  it("404 for a System that was never imported", async () => {
    expect((await post([ev()], ADMIN, "system.nope")).status).toBe(404);
  });
});

describe("POST phenome/events validation", () => {
  it("drops systemId mismatches and invalid events by index", async () => {
    const r = await post([ev({ systemId: "other" }), ev({ id: "ok" }), { nonsense: true }]);
    expect(r.json.accepted).toBe(1);
    expect(r.json.dropped[0]).toEqual({ index: 0, reason: "system-mismatch" });
    expect(r.json.dropped[1].index).toBe(2);
    expect(r.json.dropped[1].reason).toMatch(/^invalid/);
  });

  it("400 above 100 events per request and for a malformed body", async () => {
    expect((await post(Array.from({ length: PHENOME_LIMITS.eventsPerRequest + 1 }, (_, i) => ev({ id: `e${i}` })))).status).toBe(400);
    const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${sys}/phenome/events`, { method: "POST", headers: ADMIN, body: JSON.stringify({ events: "x" }) }));
    expect(res.status).toBe(400);
    expect((await post(Array.from({ length: 100 }, (_, i) => ev({ id: `f${i}` })))).json.accepted).toBe(100);
  });

  it("drops events above 8 KB", async () => {
    const r = await post([ev({ id: "big", payload: "x".repeat(PHENOME_LIMITS.eventBytes) }), ev({ id: "small" })]);
    expect(r.json.accepted).toBe(1);
    expect(r.json.dropped).toEqual([{ index: 0, reason: "too-large" }]);
  });

  it("dedupes on event id, and on content when no id is given", async () => {
    expect((await post([ev({ id: "same" })])).json.accepted).toBe(1);
    const again = await post([ev({ id: "same" })]);
    expect(again.json).toEqual({ accepted: 0, dropped: [{ index: 0, reason: "duplicate" }] });
    const t = new Date().toISOString();
    expect((await post([ev({ emittedAt: t }), ev({ emittedAt: t })])).json.accepted).toBe(1);
    expect((await get()).json.events).toHaveLength(2);
  });

  it("trims to 5,000 rows, keeping the newest", async () => {
    const rows = Array.from({ length: 5010 }, (_, i) => ({
      eventId: `r${i}`, deploymentId: null, thingId: "t", artifactId: "a", buildId: A2, commit: A2, systemCommit: null, kind: "k",
      subject: null, criterion: null, emittedAt: new Date().toISOString(), payload: i,
    }));
    await inDo((i) => i.phenomeIngest(rows, null));
    const { count, oldest } = await inDo((i) => ({
      count: Number(sqlOf(i).exec("SELECT COUNT(*) AS n FROM phenome_events").one().n),
      oldest: String(sqlOf(i).exec("SELECT event_id FROM phenome_events ORDER BY seq LIMIT 1").one().event_id),
    }));
    expect(count).toBe(PHENOME_LIMITS.rowsPerSystem);
    expect(oldest).toBe("r10");
  });
});

describe("GET phenome/events", () => {
  it("is empty for a fresh System", async () => {
    expect((await get()).json).toEqual({ events: [], versions: [] });
  });

  it("returns header fields, criterion and payload, newest first, with filters", async () => {
    await deployment("dep-1", A2, "tk");
    await post([
      ev({ id: "e1", kind: "health", subject: "svc", deploymentId: "dep-1" }),
      ev({ id: "e2", kind: "criterion.observed", criterion: "C.people.list", payload: { n: 2 }, systemCommit: "sc-1" }),
      ev({ id: "e3", commit: A1.slice(0, 10), buildId: A1.slice(0, 10), kind: "health" }),
    ]);
    const all = (await get()).json;
    expect(all.events.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect(all.events[1]).toMatchObject({ criterion: "C.people.list", payload: { n: 2 }, systemCommit: "sc-1", systemId: sys, seq: 2 });
    expect(all.events[2]).toMatchObject({ deploymentId: "dep-1", subject: "svc" });
    expect(all.events[0]).not.toHaveProperty("deploymentId");
    expect((await get("?kind=health")).json.events.map((e) => e.id)).toEqual(["e3", "e1"]);
    expect((await get("?deployment=dep-1")).json.events.map((e) => e.id)).toEqual(["e1"]);
    expect((await get(`?commit=${A1.slice(0, 7)}`)).json.events.map((e) => e.id)).toEqual(["e3"]);
    expect((await get("?commit=")).json.events).toHaveLength(3);
  });

  it("paginates with limit and before, and nextBefore only when more remain", async () => {
    await post(Array.from({ length: 5 }, (_, i) => ev({ id: `p${i}` })));
    const p1 = (await get("?limit=2")).json;
    expect(p1.events.map((e) => e.id)).toEqual(["p4", "p3"]);
    expect(p1.nextBefore).toBe(4);
    const p2 = (await get(`?limit=2&before=${p1.nextBefore}`)).json;
    expect(p2.events.map((e) => e.id)).toEqual(["p2", "p1"]);
    const p3 = (await get(`?limit=2&before=${p2.nextBefore}`)).json;
    expect(p3.events.map((e) => e.id)).toEqual(["p0"]);
    expect(p3.nextBefore).toBeUndefined();
    expect((await exports.default.fetch(new Request(`http://example.com/api/systems/${sys}/phenome/events?limit=abc`))).status).toBe(400);
  });

  it("aggregates versions by build, newest first, with counts", async () => {
    await post([
      ev({ id: "v1", deploymentId: "dep-a", systemCommit: "sc-1" }), ev({ id: "v2", deploymentId: "dep-a", systemCommit: "sc-1" }),
      ev({ id: "v3", commit: A3, buildId: A3 }),
    ]);
    const { versions } = (await get("?limit=1")).json;
    expect(versions).toEqual([
      { key: A3, buildId: A3, commit: A3, deployment: null, systemCommit: null, count: 1 },
      { key: A2, buildId: A2, commit: A2, deployment: "dep-a", systemCommit: "sc-1", count: 2 },
    ]);
  });
});

describe("registry refresh and SSE", () => {
  const registryUpdatedAt = async () => {
    const r = env.SYSTEMS.getByName(REGISTRY);
    return runInDurableObject(r, (i: SystemAuthority) => sqlOf(i).exec("SELECT updated_at FROM registry_systems WHERE system_id = ?", boot.systemId).toArray()[0]?.updated_at ?? null);
  };
  const mark = async (v: string) => {
    const r = env.SYSTEMS.getByName(REGISTRY);
    await runInDurableObject(r, (i: SystemAuthority) => { sqlOf(i).exec("UPDATE registry_systems SET updated_at = ?", v); });
  };

  it("refreshes the registry summary at most once per 10 s per System", async () => {
    const principal = await ingestPrincipal(env, sys, ADMIN.authorization);
    await ingestEvents(env, sys, principal, { events: [ev({ id: "t1" })] });
    expect(await registryUpdatedAt()).not.toBeNull();
    await mark("marker");
    await ingestEvents(env, sys, principal, { events: [ev({ id: "t2" })] });
    expect(await registryUpdatedAt()).toBe("marker");
    resetPhenomeThrottle();
    await ingestEvents(env, sys, principal, { events: [ev({ id: "t3" })] });
    expect(await registryUpdatedAt()).not.toBe("marker");
  });

  it("emits phenome.ingested on the System's SSE stream", async () => {
    const res = await stub().fetch(new Request("http://x/events"));
    const reader = res.body!.getReader();
    await reader.read(); // hello ping
    await post([ev({ id: "s1" }), ev({ id: "s2" })]);
    const text = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(JSON.parse(text.replace(/^data: /, ""))).toMatchObject({ type: "phenome.ingested", count: 2, commit: A2 });
  });
});
