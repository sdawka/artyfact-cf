import { describe, expect, it } from "vitest";
import { ARTYFACT_GENOME, artyfactGenome } from "@artyfact/ontology";
import { inspectOntologyPackage, ontologyPackageStore, ontologyPackageHash } from "../src/ontology-package";
import { loadGenome } from "../src/genome";
const base = { get: (ref: string) => ref === ARTYFACT_GENOME ? artyfactGenome : undefined };
const pkg = () => ({ format: "artyfact.ontology-package@1", id: "acme.domain", version: "1", dependencies: [], templates: {
  "template.system.acme@1": { id: "template.system.acme", version: 1, meta: 1, extends: ARTYFACT_GENOME,
    kinds: { molecule: { fields: [{ name: "name", type: "string" }], parents: ["system"] } },
    relations: { reacts: { from: ["molecule"], to: ["molecule"] } } },
} });
describe("native ontology packages", () => {
  it("loads domain kinds and relationships through an isolated template resolver", () => {
    const p = inspectOntologyPackage(pkg(), { bundled: base, accepted: [] });
    expect(p.issues).toEqual([]);
    const templates = ontologyPackageStore(base, [p.package!]);
    const model = loadGenome({ "node.yaml": "id: system.acme\nkind: system\ntemplate: template.system.acme@1\nfields: {name: Acme}\n",
      "a/node.yaml": "id: molecule.a\nkind: molecule\nfields: {name: A}\nlinks: [{rel: reacts, to: molecule.b}]\n",
      "b/node.yaml": "id: molecule.b\nkind: molecule\nfields: {name: B}\n" }, { templates });
    expect(model.nodes.map(n => n.kind)).toEqual(["molecule", "molecule"]);
    expect(base.get("template.system.acme@1")).toBeUndefined();
  });
  it("rejects conflicting immutable versions and unknown dependencies", () => {
    const original = inspectOntologyPackage(pkg(), { bundled: base, accepted: [] }).package!;
    const changed = pkg(); changed.templates["template.system.acme@1"].kinds.molecule.parents = ["thing"];
    expect(inspectOntologyPackage(changed, { bundled: base, accepted: [original] }).issues.map(i => i.message).join()).toContain("collision");
    const missing = { ...pkg(), dependencies: [{ id: "missing", version: "1", hash: "a".repeat(64) }] };
    expect(inspectOntologyPackage(missing, { bundled: base, accepted: [] }).issues.map(i => i.message).join()).toContain("dependency");
    expect(ontologyPackageHash(original)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("resolves transitive pinned dependencies but rejects undeclared private inheritance", () => {
    const a = inspectOntologyPackage(pkg(), { bundled: base, accepted: [] }).package!;
    const b = { format: "artyfact.ontology-package@1" as const, id: "acme.child", version: "1", dependencies: [{ id: a.id, version: a.version, hash: ontologyPackageHash(a) }], templates: {
      "template.system.child@1": { id: "template.system.child", version: 1, meta: 1, extends: "template.system.acme@1" },
    } };
    const checkedB = inspectOntologyPackage(b, { bundled: base, accepted: [a] }).package!;
    const c = { ...b, id: "acme.grandchild", dependencies: [{ id: b.id, version: b.version, hash: ontologyPackageHash(checkedB) }], templates: {
      "template.system.grandchild@1": { id: "template.system.grandchild", version: 1, meta: 1, extends: "template.system.child@1" },
    } };
    expect(inspectOntologyPackage(c, { bundled: base, accepted: [a, checkedB] }).issues).toEqual([]);
    expect(inspectOntologyPackage({ ...b, dependencies: [] }, { bundled: base, accepted: [a] }).issues.length).toBeGreaterThan(0);
  });
  it("retains invalid sources with structured issues and bounds payloads", () => {
    expect(inspectOntologyPackage({ ...pkg(), command: "execute" }, { bundled: base, accepted: [] }).issues.length).toBeGreaterThan(0);
    expect(inspectOntologyPackage({ text: "x".repeat(300000) }, { bundled: base, accepted: [] }).issues.map(i => i.message).join()).toContain("limit");
  });
});
