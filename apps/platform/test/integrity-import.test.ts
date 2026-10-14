import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { ImportSystemResponse, SystemImportReview } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { OntologyPackagesStore } from "../worker/ontology-packages/store";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { ADMIN, call } from "./helpers/flows";

const cleanModules = import.meta.glob("../../../examples/intent-integrity/clean/genome/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import cleanPackageText from "../../../examples/intent-integrity/clean/ontology-package.json?raw";
const cleanFiles = (): Record<string, string> => Object.fromEntries(Object.entries(cleanModules).map(([path, text]) => [path.split("/clean/genome/")[1]!, text]));

afterEach(() => setArtifactsOverride(undefined));

it("requires exact integrity or a recorded unreviewed reason for an authored source-free import", async () => {
  const systemId = `system.sourceless${crypto.randomUUID().replaceAll("-", "")}`;
  const files = cleanFiles();
  files["node.yaml"] = files["node.yaml"]!.replace("system.tool-library", systemId);
  files["intent/manifest.json"] = files["intent/manifest.json"]!.replace("system.tool-library", systemId);
  const pkg = JSON.parse(cleanPackageText);
  const artifacts = new FakeArtifacts();
  const genomeRepo = `sourceless-${crypto.randomUUID().slice(0, 8)}.genome`;
  artifacts.create(genomeRepo).commit(files, "source-free Genome");
  setArtifactsOverride(artifacts);

  await runInDurableObject(env.SYSTEMS.getByName(systemId), (_authority, state) => {
    const packages = new OntologyPackagesStore(state.storage.sql);
    const preview = packages.preview(systemId, { package: pkg, genomeFiles: files });
    expect(preview.status).toBe("review");
    packages.accept(preview.id, preview.pin!.hash);
  });

  const missing = await call<{ error: { code: string } }>("POST", "/systems/import", { systemId, genomeRepo, review: false }, ADMIN);
  expect(missing.status).toBe(422);
  expect(missing.json.error.code).toBe("integrity-required");

  const both = await call<{ error: { code: string } }>("POST", "/systems/import", {
    systemId, genomeRepo, integrityRunId: "integrity.placeholder", integrityUnreviewedReason: "Local provider is unavailable.",
  }, ADMIN);
  expect(both.status).toBe(400);
  const tooLong = await call<{ error: { code: string } }>("POST", "/systems/import", {
    systemId, genomeRepo, integrityUnreviewedReason: "x".repeat(501),
  }, ADMIN);
  expect(tooLong.status).toBe(400);

  const reason = "Local real-provider review is unavailable; this import remains pending human review.";
  const imported = await call<ImportSystemResponse>("POST", "/systems/import", {
    systemId, genomeRepo, review: false, integrityUnreviewedReason: reason,
  }, ADMIN);
  expect(imported.status, JSON.stringify(imported.json)).toBe(201);
  expect(imported.json.appCommit).toBeNull();
  expect(imported.json.integrity).toMatchObject({ state: "not-run" });
  expect(imported.json.system.systemId).toBe(systemId);
  const review = await call<SystemImportReview>("GET", `/systems/${systemId}/import-review`, undefined, ADMIN);
  expect(review.status).toBe(200);
  expect(review.json).toMatchObject({ status: "pending", integrityUnreviewed: { reason } });

  await env.SYSTEMS.getByName(systemId).setImportReview(null);
  const sameHead = await call<ImportSystemResponse>("POST", "/systems/import", {
    systemId, genomeRepo, force: true, review: false, integrityUnreviewedReason: reason,
  }, ADMIN);
  expect(sameHead.status, JSON.stringify(sameHead.json)).toBe(201);
  const restored = await call<SystemImportReview>("GET", `/systems/${systemId}/import-review`, undefined, ADMIN);
  expect(restored.status).toBe(200);
  expect(restored.json).toMatchObject({ status: "pending", integrityUnreviewed: { reason } });
});


it("exposes only the exact imported Genome integrity summary on public reads", async () => {
  const systemId = `system.summary${crypto.randomUUID().replaceAll("-", "")}`;
  const files = cleanFiles();
  files["node.yaml"] = files["node.yaml"]!.replace("system.tool-library", systemId);
  files["intent/manifest.json"] = files["intent/manifest.json"]!.replace("system.tool-library", systemId);
  const artifacts = new FakeArtifacts(), repo = `summary-${crypto.randomUUID().slice(0, 8)}.genome`;
  artifacts.create(repo).commit(files, "source-free Genome");
  setArtifactsOverride(artifacts);
  const stub = env.SYSTEMS.getByName(systemId);
  await runInDurableObject(stub, (_authority, state) => {
    const packages = new OntologyPackagesStore(state.storage.sql);
    const p = packages.preview(systemId, { package: JSON.parse(cleanPackageText), genomeFiles: files });
    packages.accept(p.id, p.pin!.hash);
  });
  const imported = await call<ImportSystemResponse>("POST", "/systems/import", {
    systemId, genomeRepo: repo, integrityUnreviewedReason: "Hosted model evidence is unavailable.",
  }, ADMIN);
  expect(imported.status).toBe(201);
  const snapshot = await stub.integrityPreview(systemId, files, "imported");
  const current = await stub.integrityStart({ snapshotId: snapshot.id, provider: "off" });
  await runDurableObjectAlarm(stub);
  const other = await stub.integrityPreview(systemId, { ...files, "intent/brief.md": files["intent/brief.md"] + "\nA different preview.\n" });
  const unrelated = await stub.integrityStart({ snapshotId: other.id, provider: "off" });
  await stub.integrityCancel(unrelated.id);

  const model = await call<{ readiness: { integrity: Record<string, unknown> } }>("GET", `/systems/${systemId}/model`);
  const readiness = await call<{ integrity: Record<string, unknown> }>("GET", `/systems/${systemId}/readiness`);
  expect(model.status).toBe(200);
  expect(model.json.readiness.integrity).toMatchObject({
    state: "completed", runId: current.id, snapshotHash: snapshot.hash, automatedStatus: "needs-review", agreementStatus: "pending",
  });
  expect(readiness.json.integrity).toEqual(model.json.readiness.integrity);
  expect(model.json.readiness.integrity).not.toHaveProperty("files");
  expect(model.json.readiness.integrity).not.toHaveProperty("report");
});
