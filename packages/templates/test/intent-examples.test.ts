import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createIntegritySnapshot, loadGenome, ontologyPackageStore, validate } from "@artyfact/model";
import { readDir } from "@artyfact/ontology/artyfact/node";
import { metaTemplates } from "../src/index";

const base = resolve(import.meta.dirname, "../../../examples/intent-integrity");
function example(name: string) {
  const dir = resolve(base, name);
  const pkg = JSON.parse(readFileSync(resolve(dir, "ontology-package.json"), "utf8"));
  const files = { ...readDir(resolve(dir, "genome")),
    "intent/brief.md": readFileSync(resolve(dir, "genome/intent/brief.md"), "utf8"),
    "intent/manifest.json": readFileSync(resolve(dir, "genome/intent/manifest.json"), "utf8"),
  };
  return { files, templates: ontologyPackageStore(metaTemplates, [pkg]) };
}

describe("executable intent-authoring controls", () => {
  it.each(["new-idea", "amendment", "clean"])("%s loads as an actual source-free Genome with intact intent", (name) => {
    const { files, templates } = example(name);
    const model = loadGenome(files, { templates });
    expect(model.things).toHaveLength(1);
    expect(model.things.flatMap(t => t.artifacts)).toEqual([]);
    expect(validate(model).findings.filter(f => f.level === "error" || f.level === "missing")).toEqual([]);
    const snapshot = createIntegritySnapshot({ systemId: model.system.id, files, templates });
    expect(snapshot.intent.fidelity).toBe("checked");
    expect(snapshot.staticFindings.filter(f => f.severity === "blocked")).toEqual([]);
  });
  it("the flawed Genome has a real dangling-reference finding, rather than only a declared expected result", () => {
    const { files, templates } = example("flawed");
    const model = loadGenome(files, { templates });
    expect(validate(model).findings).toEqual(expect.arrayContaining([expect.objectContaining({ level: "error", rule: "ref.dangling" })]));
  });
});
