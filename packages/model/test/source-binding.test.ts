import { expect, it } from "vitest";
import { loadGenome } from "../src/genome";
import { ARTYFACT_GENOME, artyfactGenome } from "@artyfact/ontology";
it("inherits artifact/repository source identity while preserving legacy files", () => {
  const templates = { get: (ref: string) => ref === ARTYFACT_GENOME ? artyfactGenome : undefined };
  const base = { "node.yaml": "id: system.scope\nkind: system\nfields: {name: Scope}\n",
    "thing/node.yaml": "id: thing.app\nkind: thing\nroot: apps/web\nsourceBinding: {artifact: artifact.web, repository: acme.web, bindingId: binding.web}\nfields: {name: App}\n",
    "thing/module/node.yaml": "id: module.a\nkind: module\nfiles: [src/**]\nfields: {name: A}\n" };
  expect(loadGenome(base, { templates }).files["module.a"]).toEqual([{ glob: "apps/web/src/**", declared: true, artifact: "artifact.web", repository: "acme.web", bindingId: "binding.web" }]);
  const legacy = { ...base, "thing/node.yaml": "id: thing.app\nkind: thing\nroot: apps/web\nfields: {name: App}\n" };
  expect(loadGenome(legacy, { templates }).files["module.a"]).toEqual([{ glob: "apps/web/src/**", declared: true }]);
});
