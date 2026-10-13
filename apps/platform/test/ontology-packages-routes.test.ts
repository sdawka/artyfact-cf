import { exports } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
import { ARTYFACT_GENOME } from "@artyfact/ontology";
import type { OntologyImportReview, OntologyImportsResponse } from "../shared/ontology-packages";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { setArtifactsOverride } from "../worker/artifacts/client";
afterEach(() => setArtifactsOverride(undefined));
const ADMIN = { authorization: "Bearer test-admin-token", "content-type": "application/json" };
async function call(method: string, path: string, body?: unknown, admin = true) {
  return exports.default.fetch(new Request(`http://example.com/api${path}`, { method,
    headers: admin ? ADMIN : { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
}
it("keeps private import reviews authorized and bootstraps a pending review destination", async () => {
  const systemId = "system.native-route";
  expect((await call("POST", "/systems/initial", { systemId }, false)).status).toBe(401);
  expect((await call("POST", "/systems/initial", { systemId, title: "Native" })).status).toBe(201);
  const path = `/systems/${systemId}/ontology-imports`;
  expect((await call("GET", path, undefined, false)).status).toBe(401);
  const request = { package: { format: "artyfact.ontology-package@1", id: "route.domain", version: "1", dependencies: [], templates: {
    "template.system.route@1": { id: "template.system.route", version: 1, meta: 1, extends: ARTYFACT_GENOME },
  } } };
  const preview = await call("POST", `${path}/preview`, request); expect(preview.status).toBe(201);
  const review = await preview.json() as OntologyImportReview;
  expect(review.status).toBe("review");
  expect((await call("POST", `${path}/${review.id}/accept`, { hash: "f".repeat(64) })).status).toBe(409);
  const accept = await call("POST", `${path}/${review.id}/accept`, { hash: review.pin!.hash });
  expect(accept.status).toBe(200);
  const accepted = await accept.json() as OntologyImportReview;
  expect(accepted.genomeFiles?.["node.yaml"]).toContain("template.system.route@1");
  // The local bootstrap command pushes these exact files; server import must use the private resolver.
  const artifacts = new FakeArtifacts();
  artifacts.create("native-route.genome").commit(accepted.genomeFiles!, "reviewed initial Genome");
  setArtifactsOverride(artifacts);
  const imported = await call("POST", "/systems/import", { systemId, genomeRepo: "native-route.genome", review: false });
  expect(imported.status, await imported.clone().text()).toBe(201);
  const model = await call("GET", `/systems/${systemId}/model`);
  expect(model.status, await model.clone().text()).toBe(200);
  const list = await call("GET", path); expect(list.status).toBe(200);
  expect((await list.json() as OntologyImportsResponse).packages).toHaveLength(1);
  const other = await call("GET", "/systems/system.unrelated/ontology-imports");
  expect(other.status).toBe(404);
});

it("rejects preview before initialization and validates every import System scope", async () => {
  const request = { package: { format: "artyfact.ontology-package@1", id: "guard.domain", version: "1", dependencies: [], templates: {
    "template.system.guard@1": { id: "template.system.guard", version: 1, meta: 1, extends: ARTYFACT_GENOME },
  } } };
  const destination = "/systems/system.preview-uninitialized/ontology-imports";
  expect((await call("POST", `${destination}/preview`, request)).status).toBe(404);
  expect((await call("GET", destination)).status).toBe(404);
  for (const id of ["__registry", "system.Bad", "system..invalid"]) {
    const path = `/systems/${id}/ontology-imports`;
    expect((await call("POST", "/systems/initial", { systemId: id })).status).toBe(400);
    expect((await call("POST", `${path}/preview`, request)).status).toBe(400);
    expect((await call("GET", path)).status).toBe(400);
    expect((await call("GET", `${path}/import.missing`)).status).toBe(400);
    expect((await call("POST", `${path}/import.missing/accept`, { hash: "a".repeat(64) })).status).toBe(400);
  }
});
