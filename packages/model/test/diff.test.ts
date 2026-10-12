import { describe, expect, it } from "vitest";
import { diffModels, loadSystem, overlap } from "../src/index";
import { edit, readTree, store } from "./helpers";

const files = readTree();
const load = (f: Map<string, string>) => loadSystem(f, { templates: store() });
const base = load(files);

describe("diffModels", () => {
  it("reports nothing for identical models (ignoring revision)", () => {
    const f = edit(files, "things/app/ontology.yaml", "kind: policy\n    name: Owner only", "kind: policy\n    revision: 7\n    name: Owner only");
    expect(diffModels(base, load(f))).toEqual({ added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] });
  });

  it("reports changed fields, affected criteria and journeys", () => {
    const f = edit(files, "things/app/ontology.yaml", "actor: owner", "actor: admin");
    const d = diffModels(base, load(f));
    expect(d.changed).toEqual([{ id: "affordance.NoteForm.save", fields: ["actor"] }]);
    expect(d.affectedCriteria).toEqual(["C.app.notes.save"]);
    expect(d.affectedJourneys).toEqual([]);
  });

  it("tracks added/removed and journeys via journeysByNode", () => {
    let f = edit(files, "things/app/ontology.yaml", "name: Edit note", "name: Edit a note");
    f = edit(f, "things/app/ontology.yaml", "  - { id: entity.Owner, kind: entity, name: Owner, parent: section.domain }\n", "  - { id: entity.Tag, kind: entity, name: Tag, parent: section.domain }\n");
    const d = diffModels(base, load(f));
    expect(d.added).toEqual(["entity.Tag"]);
    expect(d.removed).toEqual(["entity.Owner"]);
    expect(d.changed).toEqual([{ id: "screen.edit", fields: ["name"] }]);
    expect(d.affectedJourneys).toEqual(["J.notes"]);
  });

  it("flags criteria whose subject is added", () => {
    const a = edit(files, "things/app/criteria.yaml", "subjectId: affordance.NoteForm.save", "subjectId: affordance.NoteForm.delete");
    const b = edit(a, "things/app/ontology.yaml", "                links:\n                  - { rel: invokes, to: operation.note.save }\n",
      "                links:\n                  - { rel: invokes, to: operation.note.save }\n              - { id: affordance.NoteForm.delete, kind: affordance, name: Delete }\n");
    const d = diffModels(load(a), load(b));
    expect(d.added).toEqual(["affordance.NoteForm.delete"]);
    expect(d.affectedCriteria).toEqual(["C.app.notes.save"]);
  });

  it("flags criteria whose sourceRefs change", () => {
    const f = edit(files, "things/app/criteria.yaml", "sourceRefs: [S.app.notes]", "sourceRefs: []");
    const d = diffModels(base, load(f));
    expect(d.changed).toEqual([{ id: "C.app.notes.save", fields: ["sourceRefs"] }]);
    expect(d.affectedCriteria).toEqual(["C.app.notes.save"]);
  });
});

describe("overlap", () => {
  it("finds shared nodes and criteria both deltas touch", () => {
    const a = diffModels(base, load(edit(files, "things/app/ontology.yaml", "actor: owner", "actor: admin")));
    const b = diffModels(base, load(edit(files, "things/app/ontology.yaml", "Persists the note for its owner", "Persists the note")));
    const o = overlap(a, b, base);
    expect(o.shared).toEqual(["affordance.NoteForm.save"]);
    expect(o.viaCriteria).toEqual(["C.app.notes.save"]);
  });

  it("finds journey and criterion overlap without shared nodes", () => {
    const a = diffModels(base, load(edit(files, "things/app/ontology.yaml", "name: Edit note", "name: Edit a note")));
    const b = diffModels(base, load(edit(files, "things/app/ontology.yaml", "route: /notes\n", "route: /n\n")));
    const o = overlap(a, b, base);
    expect(o.shared).toEqual([]);
    expect(o.viaJourneys).toEqual(["J.notes"]);
    expect(o.viaCriteria).toEqual([]);
  });

  it("is empty for disjoint deltas", () => {
    const a = diffModels(base, load(edit(files, "externals.yaml", "name: Mail provider", "name: Mailer")));
    const b = diffModels(base, load(edit(files, "things/app/ontology.yaml", "name: Owner only", "name: Owners only")));
    expect(overlap(a, b, base)).toEqual({ shared: [], viaCriteria: [], viaJourneys: [] });
  });
});
