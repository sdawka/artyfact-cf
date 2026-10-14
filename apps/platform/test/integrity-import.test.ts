import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { ImportSystemResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { OntologyPackagesStore } from "../worker/ontology-packages/store";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { ADMIN, call } from "./helpers/flows";

const cleanModules = import.meta.glob("../../../examples/intent-integrity/clean/genome/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import cleanPackageText from "../../../examples/intent-integrity/clean/ontology-package.json?raw";
const cleanFiles = (): Record<string, string> => Object.fromEntries(Object.entries(cleanModules).map(([path, text]) => [path.split("/clean/genome/")[1]!, text]));

afterEach(() => setArtifactsOverride(undefined));

it("imports an agreed source-free Genome without requiring an application repository", async () => {
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

  const imported = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, review: false }, ADMIN);
  expect(imported.status, JSON.stringify(imported.json)).toBe(201);
  expect(imported.json.appCommit).toBeNull();
  expect(imported.json.system.systemId).toBe(systemId);
});
