import { describe, expect, it } from "vitest";
import { loadSystem, RELATIONS as EXPORTED, toFacts } from "../src/index";
import { edit, readTree, store } from "./helpers";

// docs/design/facts.md: every relation in the `.decl` list that is not derived by a pack, plus the amendments.
const RELATIONS = [
  "cardinality", "claim", "claimBeneficiary", "claimDeferred", "claimIndicator", "claimMethod", "criterion",
  "criterionDeferred", "criterionHook", "criterionSourceRef", "effectText", "entityField", "evolution",
  "evolutionAcceptance", "evolutionAffects", "ext", "hook", "journey", "journeyDeferred", "kitPinned", "kitRequired",
  "known", "link", "node", "nodeName", "parent", "policyMode", "provisional", "purpose", "purposeBeneficiary", "ref",
  "requirementEnabled", "requirementSubject", "step", "stepEnd", "stepNext", "stepOperation", "stepRef", "stepScreen",
  "stepUnresolved", "system", "templateKnown", "templateRequires", "templateRequiresCriterion", "thing",
  "thingArtifact", "thingSection", "hasActor", "hasEffects",
];
const TPL = "template.thing.mini-webapp@1";

describe("toFacts", () => {
  const files = readTree();
  const m = loadSystem(files, { templates: store() });
  const fs = toFacts(m);
  const rel = (r: string) => fs.relations.get(r) ?? [];

  it("emits only the documented relations, and the fixture exercises all but the opt-in ones", () => {
    expect([...EXPORTED].sort()).toEqual([...RELATIONS].sort());
    const keys = [...fs.relations.keys()];
    expect(keys.filter((k) => !RELATIONS.includes(k))).toEqual([]);
    expect(RELATIONS.filter((k) => !keys.includes(k)).sort()).toEqual([
      "claimDeferred", "criterionDeferred", "journeyDeferred", "provisional", "stepUnresolved",
    ]);
  });

  it("emits structure facts", () => {
    expect(rel("system")).toEqual([["system.mini"]]);
    expect(rel("thing")).toEqual([["thing.app", TPL]]);
    expect(rel("thingArtifact")).toEqual([["thing.app", "artifact.app"]]);
    expect(rel("thingSection")).toEqual([["thing.app", "section.domain"], ["thing.app", "section.ui"]]);
    expect(rel("node")).toContainEqual(["screen.list", "screen", "thing.app"]);
    expect(rel("node")).toContainEqual(["thing.app", "thing", "thing.app"]);
    expect(rel("node")).toContainEqual(["system.mini", "system", ""]);
    expect(rel("node")).toContainEqual(["ext.owner", "external", ""]);
    expect(rel("nodeName")).toContainEqual(["policy.ownerOnly", "owner only"]);
    expect(rel("parent")).toContainEqual(["thing.app", "system.mini"]);
    expect(rel("parent")).toContainEqual(["section.domain", "thing.app"]);
    expect(rel("link")).toContainEqual(["policy.ownerOnly", "governs", "operation.note.save", "declared"]);
    expect(rel("policyMode")).toEqual([["policy.ownerOnly", "owner-only"]]);
    expect(rel("effectText")).toEqual([["affordance.NoteForm.save", "persists the note for its owner"]]);
    expect(rel("entityField")).toContainEqual(["entity.Note", "owner", "ref:entity.Owner"]);
    expect(rel("entityField").map((t) => t[0])).not.toContain("component.NoteForm");
    expect(rel("cardinality")).toEqual([["component.NoteRow", "1 per note"]]);
    expect(rel("hasActor")).toEqual([["affordance.NoteForm.save"]]);
    expect(rel("hasEffects")).toEqual([["affordance.NoteForm.save"]]);
  });

  it("emits ref for every reference that must resolve and known for every declared id", () => {
    expect(rel("ref")).toContainEqual(["screen.list", "parent", "section.ui"]);
    expect(rel("ref")).toContainEqual(["policy.ownerOnly", "links", "entity.Note"]);
    expect(rel("ref")).toContainEqual(["S.app.notes", "subjects", "screen.edit"]);
    expect(rel("ref")).toContainEqual(["S.app.notes", "refines", "GD.notes"]);
    expect(rel("ref")).toContainEqual(["C.app.notes.save", "sourceRefs", "S.app.notes"]);
    expect(rel("ref")).toContainEqual(["P1", "beneficiaries", "ext.owner"]);
    expect(rel("ref")).toContainEqual(["evolution.1", "acceptanceCriteria", "C.app.exists"]);
    expect(rel("ref")).toContainEqual(["J.notes/s3", "operation", "operation.note.save"]);
    const known = new Set(rel("known").map((t) => t[0]));
    for (const id of ["system.mini", "thing.app", "screen.list", "ext.mail", "P1", "T1", "GD.notes", "commitment.private",
      "S.app.notes", "C.app.exists", "hook.app.exists", "J.notes", "J.notes/s2", "evolution.1", TPL, "privacy"]) {
      expect(known.has(id), id).toBe(true);
    }
    const unresolved = rel("ref").filter((t) => !known.has(t[2] as string));
    expect(unresolved).toEqual([]);
  });

  it("emits theory, spec, criteria, journey, evolution, template and kit facts", () => {
    expect(rel("ext")).toContainEqual(["ext.mail", "service"]);
    expect(rel("purpose")).toEqual([["P1"]]);
    expect(rel("purposeBeneficiary")).toEqual([["P1", "ext.owner"]]);
    expect(rel("claim")).toEqual([["T1"]]);
    expect(rel("claimIndicator")).toEqual([["T1"]]);
    expect(rel("claimMethod")).toEqual([["T1"]]);
    expect(rel("claimBeneficiary")).toEqual([["T1", "ext.owner"]]);
    expect(rel("requirementEnabled")).toEqual([["S.app.notes"]]);
    expect(rel("requirementSubject")).toContainEqual(["S.app.notes", "screen.edit"]);
    expect(rel("criterion")).toContainEqual(["C.app.notes.save", "thing", "thing.app", "affordance.NoteForm.save", "hard"]);
    expect(rel("criterion")).toContainEqual(["C.app.exists", "thing", "thing.app", "thing.app", "hard"]);
    expect(rel("criterionSourceRef")).toEqual([["C.app.notes.save", "S.app.notes"]]);
    expect(rel("criterionHook")).toContainEqual(["C.app.notes.save", "hook.app.notes.save"]);
    expect(rel("hook")).toContainEqual(["hook.app.notes.save", "defined"]);
    expect(rel("journey")).toEqual([["J.notes", "s1"]]);
    expect(rel("step")).toContainEqual(["J.notes", "s2"]);
    expect(rel("stepEnd")).toEqual([["J.notes", "e1"]]);
    expect(rel("stepNext")).toContainEqual(["J.notes", "s2", "e1"]);
    expect(rel("stepScreen")).toContainEqual(["J.notes", "s1", "screen.list"]);
    expect(rel("stepOperation")).toEqual([["J.notes", "s3", "operation.note.save"]]);
    expect(rel("stepRef")).toContainEqual(["J.notes", "s3", "S.app.notes"]);
    expect(rel("evolution")).toEqual([["evolution.1", "proposed"]]);
    expect(rel("evolutionAffects")).toContainEqual(["evolution.1", "operation.note.save"]);
    expect(rel("evolutionAcceptance")).toContainEqual(["evolution.1", "C.app.exists"]);
    expect(rel("templateKnown")).toEqual([[TPL]]);
    expect(rel("templateRequires")).toEqual([[TPL, "section.domain"], [TPL, "section.ui"]]);
    expect(rel("templateRequiresCriterion")).toEqual([[TPL, "C.app.exists"]]);
    expect(rel("kitPinned")).toEqual([["privacy", "1.0.0"]]);
    expect(rel("kitRequired")).toEqual([["auth"], ["privacy"]]);
  });

  it("emits opt-in facts when declared, and skips refs from unresolved steps", () => {
    let f = edit(files, "things/app/ontology.yaml", "{ id: entity.Owner, kind: entity, name: Owner, parent: section.domain }", "{ id: entity.Owner, kind: entity, name: Owner, parent: section.domain, provisional: true }");
    f = edit(f, "journeys/J.notes.yaml", "{ id: s1, actor: user, action: Open notes, screen: screen.list,", "{ id: s1, actor: user, action: Open notes, screen: screen.future, unresolved: true,");
    f = edit(f, "theory.yaml", "limitation: Lab conditions only", "limitation: Lab conditions only\n    deferred: true");
    const r = toFacts(loadSystem(f, { templates: store() }));
    expect(r.relations.get("provisional")).toEqual([["entity.Owner"]]);
    expect(r.relations.get("claimDeferred")).toEqual([["T1"]]);
    expect(r.relations.get("stepUnresolved")).toEqual([["J.notes", "s1"]]);
    expect(r.relations.get("stepRef")).toContainEqual(["J.notes", "s1", "screen.future"]);
    expect(r.relations.get("ref")!.filter((t) => t[2] === "screen.future")).toEqual([]);
  });

  it("emits link in OUT orientation for direction: in", () => {
    const f = edit(files, "things/app/ontology.yaml", "- { rel: reads, to: entity.Note }", "- { rel: reads, to: entity.Note }\n      - { rel: governs, to: policy.ownerOnly, direction: in }");
    expect(toFacts(loadSystem(f, { templates: store() })).relations.get("link")).toContainEqual(["policy.ownerOnly", "governs", "operation.note.list", "declared"]);
  });

  it("hashes deterministically regardless of file order", () => {
    const reversed = loadSystem(new Map([...files].reverse()), { templates: store() });
    expect(toFacts(reversed).hash).toBe(fs.hash);
    expect(fs.hash).toMatch(/^[0-9a-f]{64}$/);
    const changed = edit(files, "kits.yaml", "version: 1.0.0", "version: 1.0.1");
    expect(toFacts(loadSystem(changed, { templates: store() })).hash).not.toBe(fs.hash);
  });
});
