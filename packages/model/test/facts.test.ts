import { describe, expect, it, vi } from "vitest";
import { loadSystem, RELATIONS as EXPORTED, toFacts } from "../src/index";
import { readTree, store } from "./helpers";

vi.mock("@artyfact/rules", () => import("./stubs/rules"));

const RELATIONS = [
  "node", "name", "parent", "link", "thing", "section", "requirement", "reqSubject", "refines", "criterion", "gate",
  "hook", "sourceRef", "satisfies", "purpose", "beneficiary", "external", "claim", "claimHas", "journey", "step",
  "stepScreen", "stepOp", "stepNext", "evolution", "affects", "acceptance", "templateRequires", "fromTemplate",
  "provisional", "effectText", "fieldType", "cardinality", "invariant", "policyConflict", "kitPinned", "kitRequired",
];

describe("toFacts", () => {
  const files = readTree();
  const m = loadSystem(files, { templates: store() });
  const fs = toFacts(m);
  const rel = (r: string) => fs.relations.get(r) ?? [];

  it("emits only the documented relations, and the fixture exercises all but the opt-in ones", () => {
    expect([...EXPORTED].sort()).toEqual([...RELATIONS].sort());
    const keys = [...fs.relations.keys()];
    expect(keys.filter((k) => !RELATIONS.includes(k))).toEqual([]);
    expect(RELATIONS.filter((k) => !keys.includes(k)).sort()).toEqual(["policyConflict", "provisional", "satisfies"]);
  });

  it("emits the expected tuples", () => {
    expect(rel("node")).toContainEqual(["screen.list", "screen", "thing.app"]);
    expect(rel("node")).toContainEqual(["thing.app", "thing", "thing.app"]);
    expect(rel("node")).toContainEqual(["system.mini", "system", ""]);
    expect(rel("name")).toContainEqual(["screen.list", "Notes"]);
    expect(rel("parent")).toContainEqual(["thing.app", "system.mini"]);
    expect(rel("parent")).toContainEqual(["section.domain", "thing.app"]);
    expect(rel("link")).toContainEqual(["policy.ownerOnly", "governs", "operation.note.save", "declared"]);
    expect(rel("thing")).toEqual([["thing.app", "template.thing.mini-webapp@1"]]);
    expect(rel("section")).toEqual([["thing.app", "section.domain"], ["thing.app", "section.ui"]]);
    expect(rel("requirement")).toEqual([["S.app.notes", "thing.app", true]]);
    expect(rel("reqSubject")).toContainEqual(["S.app.notes", "screen.edit"]);
    expect(rel("refines")).toContainEqual(["S.app.notes", "GD.notes"]);
    expect(rel("criterion")).toContainEqual(["C.app.notes.save", "thing", "thing.app", "affordance", "affordance.NoteForm.save", "artifact", "hard", false]);
    expect(rel("gate")).toContainEqual(["C.system.structure", "promotion"]);
    expect(rel("hook")).toContainEqual(["hook.app.notes.save", "C.app.notes.save", "vitest", "execution", "defined"]);
    expect(rel("sourceRef")).toEqual([["C.app.notes.save", "S.app.notes"]]);
    expect(rel("purpose")).toEqual([["P1"]]);
    expect(rel("beneficiary")).toEqual([["P1", "ext.owner"]]);
    expect(rel("external")).toContainEqual(["ext.mail", "service"]);
    expect(rel("claim")).toEqual([["T1", false]]);
    expect(rel("claimHas")).toContainEqual(["T1", "indicator"]);
    expect(rel("claimHas")).toContainEqual(["T1", "evaluationMethod"]);
    expect(rel("journey")).toEqual([["J.notes", false]]);
    expect(rel("step")).toContainEqual(["J.notes", "s2", "branch"]);
    expect(rel("stepScreen")).toContainEqual(["J.notes", "s1", "screen.list"]);
    expect(rel("stepOp")).toEqual([["J.notes", "s3", "operation.note.save"]]);
    expect(rel("stepNext")).toContainEqual(["J.notes", "s2", "e1"]);
    expect(rel("evolution")).toEqual([["evolution.1", "proposed", "implementation"]]);
    expect(rel("affects")).toContainEqual(["evolution.1", "operation.note.save"]);
    expect(rel("acceptance")).toContainEqual(["evolution.1", "C.app.exists"]);
    expect(rel("templateRequires")).toEqual([["template.thing.mini-webapp@1", "section.domain"], ["template.thing.mini-webapp@1", "section.ui"]]);
    expect(rel("fromTemplate")).toContainEqual(["component.AppShell", "template.thing.mini-webapp@1"]);
    expect(rel("fromTemplate")).toContainEqual(["C.app.exists", "template.thing.mini-webapp@1"]);
    expect(rel("effectText")).toEqual([["affordance.NoteForm.save", "Persists the note for its owner"]]);
    expect(rel("fieldType")).toContainEqual(["entity.Note", "owner", "ref:entity.Owner"]);
    expect(rel("cardinality")).toEqual([["component.NoteRow", "1 per note"]]);
    expect(rel("invariant")).toEqual([["entity.Note", "body is non-empty"]]);
    expect(rel("kitPinned")).toEqual([["privacy", "1.0.0"]]);
    expect(rel("kitRequired")).toEqual([["privacy"]]);
  });

  it("emits provisional and policyConflict when declared", () => {
    const f = new Map(files);
    f.set("things/app/ontology.yaml", f.get("things/app/ontology.yaml")!
      .replace("{ id: entity.Owner, kind: entity, name: Owner, parent: section.domain }", "{ id: entity.Owner, kind: entity, name: Owner, parent: section.domain, provisional: true }")
      .replace("- { rel: governs, to: entity.Note }", "- { rel: governs, to: entity.Note }\n      - { rel: references, to: policy.public, label: conflicts }"));
    const r = toFacts(loadSystem(f, { templates: store() }));
    expect(r.relations.get("provisional")).toEqual([["entity.Owner"]]);
    expect(r.relations.get("policyConflict")).toEqual([["policy.ownerOnly", "policy.public"]]);
  });

  it("hashes deterministically regardless of file order", () => {
    const reversed = loadSystem(new Map([...files].reverse()), { templates: store() });
    expect(toFacts(reversed).hash).toBe(fs.hash);
    expect(fs.hash).toMatch(/^[0-9a-f]{64}$/);
    const changed = new Map(files).set("kits.yaml", "kits:\n  - { id: privacy, version: 1.0.1 }\n");
    expect(toFacts(loadSystem(changed, { templates: store() })).hash).not.toBe(fs.hash);
  });
});
