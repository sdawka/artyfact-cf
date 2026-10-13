import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { OntologyPackagesStore } from "../worker/ontology-packages/store";
import { ARTYFACT_GENOME } from "@artyfact/ontology";
const pkg = { format: "artyfact.ontology-package@1", id: "private.domain", version: "1", dependencies: [], templates: {
  "template.system.private@1": { id: "template.system.private", version: 1, meta: 1, extends: ARTYFACT_GENOME },
} };
describe("OntologyPackagesStore", () => {
  it("preserves invalid inspection, accepts only reviewed hashes and rejects version replacement", async () => {
    await runInDurableObject(env.SYSTEMS.getByName("system.ontology"), (_i, state) => {
      const s = new OntologyPackagesStore(state.storage.sql);
      s.initialize("system.ontology", "Domain");
      const invalid = s.preview("system.ontology", { package: { text: "not native" } });
      expect(invalid.status).toBe("invalid"); expect(s.get(invalid.id)?.package).toEqual({ text: "not native" });
      expect(() => s.accept(invalid.id, "wrong")).toThrow();
      const review = s.preview("system.ontology", { package: pkg });
      expect(review.status).toBe("review");
      expect(() => s.accept(review.id, "wrong")).toThrow(/hash/);
      expect(s.accept(review.id, review.pin!.hash).status).toBe("accepted");
      expect(s.acceptedPackages()).toHaveLength(1);
      expect(s.preview("system.ontology", { package: { ...pkg, templates: { ...pkg.templates,
        "template.system.other@1": { id: "template.system.other", version: 1, meta: 1, extends: ARTYFACT_GENOME },
      } } }).status).toBe("invalid");
      expect(() => s.preview("system.other", { package: pkg })).toThrow(/scope/);
    });
    await runInDurableObject(env.SYSTEMS.getByName("system.other"), (_i, state) => {
      expect(new OntologyPackagesStore(state.storage.sql).acceptedPackages()).toEqual([]);
    });
  });
  it("keeps Genome parse issues reviewable and requires source mappings for a supplied Genome", async () => {
    await runInDurableObject(env.SYSTEMS.getByName("system.mapping"), (_i, state) => {
      const s = new OntologyPackagesStore(state.storage.sql);
      const r = s.preview("system.mapping", { package: pkg, genomeFiles: { "node.yaml": "id: system.mapping\nkind: system\ntemplate: template.system.private@1\nfields: {name: Mapping}\n",
        "module/node.yaml": "id: module.a\nkind: module\nfields: {name: A}\n" } });
      expect(r.status).toBe("invalid"); expect(r.issues.some(i => i.message.includes("source mapping"))).toBe(true);
    });
  });
});
