import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiError, ImportSystemResponse, PartResponse, PartsResponse, StartWorkResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { appFiles, genomeFiles, genomeFor } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";

const ADMIN = { authorization: "Bearer test-admin-token" };
let n = 0;

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: response.status, json: await response.json() as T };
}

function packageBody(id: string, extra: Record<string, unknown> = {}) {
  return { package: { id, version: "1.0.0", name: id, visibility: "shared", payload: { files: { "src/part.ts": "export {}\n" } }, ...extra } };
}

async function imported() {
  const suffix = ++n;
  const systemId = `system.parts${suffix}`;
  const genomeRepo = `parts-genome-${suffix}`, appRepo = `parts-app-${suffix}`;
  const artifacts = new FakeArtifacts();
  artifacts.create(genomeRepo).commit({
    ...genomeFor(systemId),
  }, "genome");
  artifacts.create(appRepo).commit(appFiles, "app");
  setArtifactsOverride(artifacts);
  const imported = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo }, ADMIN);
  expect(imported.status, JSON.stringify(imported.json)).toBe(201);
  return systemId;
}

afterEach(() => setArtifactsOverride(undefined));

describe("parts routes", () => {
  it("keeps the shared catalog public but requires admin publication", async () => {
    const id = `part.shared.route${++n}`;
    expect((await call<ApiError>("POST", "/parts", packageBody(id))).status).toBe(401);

    const published = await call<PartResponse>("POST", "/parts", packageBody(id), ADMIN);
    expect(published.status).toBe(201);
    expect(published.json.part.package.published).toBe(true);

    const listed = await call<PartsResponse>("GET", "/parts");
    expect(listed.status).toBe(200);
    expect(listed.json.parts.some((part) => part.partId === id)).toBe(true);
  });

  it("does not allow unauthenticated callers to enumerate a System-private catalog", async () => {
    const systemId = await imported();
    const privatePart = packageBody(`part.private.route${++n}`, { visibility: "system-private", systemId });
    expect((await call<PartResponse>("POST", `/systems/${systemId}/parts`, privatePart, ADMIN)).status).toBe(201);

    const denied = await call<ApiError>("GET", `/systems/${systemId}/parts`);
    expect(denied.status).toBe(401);
    const allowed = await call<PartsResponse>("GET", `/systems/${systemId}/parts`, undefined, ADMIN);
    expect(allowed.status).toBe(200);
    expect(allowed.json.parts).toHaveLength(1);
  });

  it("bounds publication bodies and refuses a caller-selected nonexistent System scope", async () => {
    const tooLarge = await call<ApiError>("POST", "/parts", packageBody(`part.large.route${++n}`), {
      ...ADMIN, "content-length": String(256 * 1024 + 1),
    });
    expect(tooLarge.status).toBe(413);

    const unknown = await call<ApiError>("POST", "/systems/system.unimported/parts", packageBody(`part.unknown.route${++n}`, {
      visibility: "system-private", systemId: "system.unimported",
    }), ADMIN);
    expect(unknown.status).toBe(404);
  });
});
