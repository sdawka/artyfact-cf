/** The real example System and app (examples/) through the import → start → submit path, hooks as no-ops. */
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiError, ImportSystemResponse, ModelBundle, StartWorkResponse, SubmitResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../examples/keep-in-touch-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-system/");
const app = raw(import.meta.glob(["../../../examples/keep-in-touch-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-app/");

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

afterEach(() => setArtifactsOverride(undefined));

describe("examples/keep-in-touch", () => {
  it("imports, packets evolution.1 from the app's source map, and blocks promotion with no-op hooks", async () => {
    const ns = new FakeArtifacts();
    ns.create("ex-system").commit(genome);
    ns.create("ex-app").commit(app);
    setArtifactsOverride(ns);
    const systemId = /^id:\s*(\S+)/m.exec(genome["system.yaml"])![1];

    const imp = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo: "ex-system", appRepo: "ex-app" });
    expect(imp.status, JSON.stringify(imp.json)).toBe(201);
    expect(imp.json.evolutions).toContain("evolution.1");
    const model = await call<ModelBundle>("GET", `/systems/${systemId}/model`);
    expect(model.json.model.index.byId["screen.people"]?.kind).toBe("screen");

    const start = await call<StartWorkResponse>("POST", `/systems/${systemId}/evolutions/evolution.1/realizations`, { agentLabel: "a" });
    expect(start.status, JSON.stringify(start.json)).toBe(201);
    expect(start.json.packet.permittedPaths).toEqual(expect.arrayContaining(["src/index.ts", "src/worker/routes/contacts.ts", "public/people/**"]));
    expect(start.json.packet.protectedPaths).toEqual(["system/**", "assays/**"]);
    expect(start.json.packet.acceptanceCriteria.map((c) => c.id)).toContain("C.webapp.exists");

    const commit = ns.repo("ex-app--r1").commit({ ...app, "public/people/list.js": "export {}" });
    const sub = await call<SubmitResponse>("POST", `/systems/${systemId}/realizations/${start.json.realization.id}/submit`, { commit });
    expect(sub.status, JSON.stringify(sub.json)).toBe(201);
    expect(sub.json.candidate.changedSubjects).toEqual(["component.AddContactDialog", "screen.people"]);

    const promote = await call<ApiError>("POST", `/systems/${systemId}/promote`,
      { candidateIds: [sub.json.candidate.id], expectedHead: imp.json.head, rationale: "" }, { authorization: "Bearer test-admin-token" });
    expect(promote.status).toBe(409);
    expect(promote.json.error.code).toBe("blocked");
  });
});
