/// <reference types="vite/client" />
/** The real example System and app (examples/) through the import → start → submit path, hooks as no-ops. */
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiError, ImportSystemResponse, ModelBundle, SerializedModel, StartWorkResponse, SubmitResponse, SystemsResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../examples/peopling-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-system/");
const app = raw(import.meta.glob(["../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-app/");

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

afterEach(() => setArtifactsOverride(undefined));

describe("examples/peopling", () => {
  it("imports, packets evolution.1 from the app's source map, and blocks promotion with no-op hooks", async () => {
    const ns = new FakeArtifacts();
    ns.create("ex-system").commit(genome);
    ns.create("ex-app").commit(app);
    setArtifactsOverride(ns);
    const systemId = /^id:\s*(\S+)/m.exec(genome["node.yaml"])![1];

    const imp = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo: "ex-system", appRepo: "ex-app", review: false }, { authorization: "Bearer test-admin-token" });
    expect(imp.status, JSON.stringify(imp.json)).toBe(201);
    expect(imp.json.evolutions).toContain("evolution.1");
    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect((model.json.model as SerializedModel).index.byId["screen.people"]?.kind).toBe("screen");
    // Provisional template nodes are reported as missing but block nowhere: not in the bundle's blockers, not in Home's counts.
    const readiness = model.json.readiness.modelReadiness;
    expect(readiness.findings.filter((f) => f.rule === "node.provisional").length).toBeGreaterThan(0);
    expect(readiness.blockers).toEqual([]);
    const summary = (await call<SystemsResponse>("GET", "/systems")).json.systems.find((x) => x.systemId === systemId)!;
    expect(summary.readiness).toEqual({ errors: 0, missing: 0 });

    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" }, { authorization: "Bearer test-admin-token" });
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    expect(start.json.packet.permittedPaths).toEqual(expect.arrayContaining(["src/index.ts", "src/worker/routes/contacts.ts", "public/people/**"]));
    expect(start.json.packet.protectedPaths).toEqual(["system/**", "assays/**"]);
    expect(start.json.packet.acceptanceCriteria.map((c) => c.id)).toContain("C.webapp.exists");

    const commit = ns.repo("ex-app--r1").commit({ ...app, "public/people/list.js": "export {}" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${start.json.realization.id}/submit`, { commit }, { authorization: `Bearer ${start.json.secret}` });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(sub.json.candidate.changedSubjects).toEqual(["component.AddContactDialog", "screen.people"]);

    const promote = await call<ApiError>("POST", `/systems/${systemId}/promote`,
      { candidateIds: [sub.json.candidate.id], expectedHead: imp.json.head, rationale: "" }, { authorization: "Bearer test-admin-token" });
    expect(promote.status, JSON.stringify(promote.json)).toBe(409);
    expect(promote.json.error.code).toBe("blocked");
  });
});

describe("gate on the real Genome", () => {
  it("names only deployment/outcome/selection-stage hooks off-trigger", async () => {
    const { buildGenome } = await import("../worker/artifacts/genome-source");
    const { gateCriteria } = await import("../worker/promotion");
    const g = buildGenome(new Map(Object.entries(genome)), "0".repeat(40));
    const evo = g.model.evolutions.find((e) => e.id === "evolution.1")!;
    const gates = gateCriteria(g.model, evo);
    expect(gates.find((x) => x.id === "C.system.purpose")).toMatchObject({ blocking: true, offTriggerHooks: ["hook.system.purpose.outcome"] });
    // Promotion-stage and submission-stage hooks are never off-trigger.
    expect(gates.find((x) => x.id === "C.system.promotion")?.offTriggerHooks).toBeUndefined();
    expect(gates.find((x) => x.id === "C.webapp.exists")?.offTriggerHooks).toBeUndefined();
  });

  it("gates a Genome candidate on model-level criteria only, keeping its acceptance criteria", async () => {
    const { buildGenome } = await import("../worker/artifacts/genome-source");
    const { gateCriteria } = await import("../worker/promotion");
    const g = buildGenome(new Map(Object.entries(genome)), "0".repeat(40));
    const evo5 = g.model.evolutions.find((e) => e.id === "evolution.5")!;
    const ids = gateCriteria(g.model, evo5, { target: "genome" }).map((x) => x.id);
    expect(ids).toContain("C.system.promotion");
    expect(ids).toContain("C.system.topology");
    expect(ids.filter((id) => id.startsWith("C.webapp.") && !evo5.acceptanceCriteria.includes(id))).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(evo5.acceptanceCriteria));
    // App candidates keep the artifact criteria.
    expect(gateCriteria(g.model, evo5, { target: "app" }).map((x) => x.id)).toContain("C.webapp.exists");
  });

  it("keeps a non-deferred artifact acceptance criterion blocking for a Genome candidate", async () => {
    const { buildGenome } = await import("../worker/artifacts/genome-source");
    const { gateCriteria } = await import("../worker/promotion");
    const g = buildGenome(new Map(Object.entries(genome)), "0".repeat(40));
    const evo1 = g.model.evolutions.find((e) => e.id === "evolution.1")!;
    expect(evo1.acceptanceCriteria).toContain("C.webapp.exists");
    expect(gateCriteria(g.model, evo1, { target: "genome" }).find((x) => x.id === "C.webapp.exists")).toMatchObject({ blocking: true });
  });
});
