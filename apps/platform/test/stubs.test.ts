import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  routes, type BuildsResponse, type DeploymentsResponse, type FileResponse,
  type FilesResponse, type PhenomeEventsResponse,
} from "../shared/api";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";

// Iteration-2 route stubs (B0): every route answers with its typed empty shape (reads) or 501 (writes).

const S = "system.stubs";
const sha = "0123456789abcdef0123456789abcdef01234567";

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await exports.default.fetch(new Request(`http://example.com${path}`, {
    method, headers: { "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}
const get = async <T>(path: string) => {
  const r = await call<T>("GET", path);
  expect(r.status).toBe(200);
  return r.json;
};

beforeAll(async () => {
  // Reads under /api/systems/:id are 404 unless the registry knows the System.
  await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => {
    i.registerSystem({ systemId: S, title: "stubs", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: sha, evolutionCounts: {}, updatedAt: "" });
  });
});

describe("route builders", () => {
  it("encode path segments and drop empty query values", () => {
    expect(routes.file(S, "app", "src/a b.ts", "head")).toBe(`/api/systems/${S}/file?scope=app&ref=head&path=src%2Fa%20b.ts`);
    expect(routes.files(S, "genome")).toBe(`/api/systems/${S}/files?scope=genome`);
    expect(routes.changelog(S)).toBe(`/api/systems/${S}/changelog`);
    expect(routes.changelog(S, { limit: 20, before: "sc-3" })).toBe(`/api/systems/${S}/changelog?limit=20&before=sc-3`);
    expect(routes.compareSystem(S, undefined, "sc-2")).toBe(`/api/systems/${S}/compare/system?to=sc-2`);
    expect(routes.builds(S, { kind: "production" })).toBe(`/api/systems/${S}/builds?kind=production`);
    expect(routes.phenomeEvents(S, { deployment: "d1", before: 9 })).toBe(`/api/systems/${S}/phenome/events?deployment=d1&before=9`);
    expect(routes.editorCommit(S, "realization.1.r1")).toBe(`/api/systems/${S}/realizations/realization.1.r1/commit`);
    expect(routes.deploymentIngestToken(S, "dep 1")).toBe(`/api/systems/${S}/deployments/dep%201/ingest-token`);
  });
});

describe("read stubs return typed empty shapes", () => {
  it("editor", async () => {
    expect(await get<FilesResponse>(routes.files(S, "app"))).toEqual({ ref: { ref: "head", repo: "", commit: "" }, files: [] });
    const f = await get<FileResponse>(routes.file(S, "genome", "system.yaml", sha));
    expect(f).toMatchObject({ ref: { ref: sha }, path: "system.yaml", text: null, size: 0, truncated: false, binary: false });
  });

  it("builds and deployments", async () => {
    expect(await get<BuildsResponse>(routes.realizationBuilds(S, "realization.1.r1"))).toEqual({ builds: [] });
    expect(await get<BuildsResponse>(routes.builds(S, { commit: sha, kind: "preview" }))).toEqual({ builds: [] });
    expect(await get<DeploymentsResponse>(routes.deployments(S))).toEqual({ production: null, history: [] });
  });

  it("phenome", async () => {
    expect(await get<PhenomeEventsResponse>(routes.phenomeEvents(S, { limit: 10 }))).toEqual({ events: [], versions: [] });
  });

  it("are still 404 for a System the registry does not know", async () => {
    expect((await call("GET", routes.revisions("system.nope"))).status).toBe(404);
  });
});

describe("write stubs are 501 not-implemented", () => {
  it.each([
    ["editor commit", routes.editorCommit(S, "realization.1.r1"), { message: "m", changes: [] }],
    ["realization build report", routes.realizationBuilds(S, "realization.1.r1"), { status: "passed", commit: sha }],
    ["production build report", routes.builds(S), { status: "passed", commit: sha, kind: "production" }],
    ["create deployment", routes.deployments(S), {}],
    ["ingest token", routes.deploymentIngestToken(S, "dep-1"), {}],
    ["create evolution", routes.evolutions(S), { title: "t", intent: "i" }],
  ])("%s", async (_name, path, body) => {
    const r = await call<{ error: string }>("POST", path, body);
    expect(r.status).toBe(501);
    expect(r.json).toEqual({ error: "not-implemented" });
  });
});
