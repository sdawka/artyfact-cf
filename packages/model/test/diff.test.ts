import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { diffModels, overlap } from "../src/index";
import { edit, load, pathOf, readTree } from "./helpers";

const files = readTree();
const base = load(files);
const SAVE = pathOf(files, "affordance.NoteForm.save");
const at = (id: string) => pathOf(files, id);

describe("diffModels", () => {
  it("reports nothing for identical models (ignoring revision)", () => {
    const f = edit(files, at("policy.ownerOnly"), "revision: 1", "revision: 7");
    expect(diffModels(base, load(f))).toEqual({ added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] });
  });

  it("reports changed fields, affected criteria and journeys", () => {
    const f = edit(files, SAVE, "actor: owner", "actor: admin");
    const d = diffModels(base, load(f));
    expect(d.changed).toEqual([{ id: "affordance.NoteForm.save", fields: ["actor"] }]);
    expect(d.affectedCriteria).toEqual(["C.app.notes.save"]);
    expect(d.affectedJourneys).toEqual([]);
  });

  it("tracks added/removed and journeys via journeysByNode", () => {
    const f = edit(files, at("screen.edit"), "name: Edit note", "name: Edit a note");
    const owner = at("entity.Owner");
    f.delete(owner);
    f.set(owner.replace("entity.Owner", "entity.Tag"), "id: entity.Tag\nkind: entity\nfields:\n  name: Tag\n");
    const d = diffModels(base, load(f));
    expect(d.added).toEqual(["entity.Tag"]);
    expect(d.removed).toEqual(["entity.Owner"]);
    expect(d.changed).toEqual([{ id: "screen.edit", fields: ["name"] }]);
    expect(d.affectedJourneys).toEqual(["J.notes"]);
  });

  it("flags criteria whose subject is added", () => {
    const crit = files.get(SAVE)!.match(/criteria:[\s\S]*$/)![0];
    const f = new Map(files).set(SAVE, files.get(SAVE)!.replace(crit, ""))
      .set(SAVE.replace("affordance.NoteForm.save", "affordance.NoteForm.delete"), `id: affordance.NoteForm.delete\nkind: affordance\nfields:\n  name: Delete\n${crit}`);
    const d = diffModels(base, load(f));
    expect(d.added).toEqual(["affordance.NoteForm.delete"]);
    expect(d.affectedCriteria).toEqual(["C.app.notes.save"]);
  });

  it("flags criteria whose sourceRefs change", () => {
    const f = edit(files, SAVE, "    sourceRefs:\n      - S.app.notes\n", "");
    const d = diffModels(base, load(f));
    expect(d.changed).toEqual([{ id: "C.app.notes.save", fields: ["sourceRefs"] }]);
    expect(d.affectedCriteria).toEqual(["C.app.notes.save"]);
  });
});

describe("overlap", () => {
  it("finds shared nodes and criteria both deltas touch", () => {
    const a = diffModels(base, load(edit(files, SAVE, "actor: owner", "actor: admin")));
    const b = diffModels(base, load(edit(files, SAVE, "Persists the note for its owner", "Persists the note")));
    const o = overlap(a, b, base);
    expect(o.shared).toEqual(["affordance.NoteForm.save"]);
    expect(o.viaCriteria).toEqual(["C.app.notes.save"]);
  });

  it("finds journey and criterion overlap without shared nodes", () => {
    const a = diffModels(base, load(edit(files, at("screen.edit"), "name: Edit note", "name: Edit a note")));
    const b = diffModels(base, load(edit(files, at("screen.list"), "route: /notes\n", "route: /n\n")));
    const o = overlap(a, b, base);
    expect(o.shared).toEqual([]);
    expect(o.viaJourneys).toEqual(["J.notes"]);
    expect(o.viaCriteria).toEqual([]);
  });

  it("is empty for disjoint deltas", () => {
    const a = diffModels(base, load(edit(files, at("ext.mail"), "name: Mail provider", "name: Mailer")));
    const b = diffModels(base, load(edit(files, at("policy.ownerOnly"), "name: Owner only", "name: Owners only")));
    expect(overlap(a, b, base)).toEqual({ shared: [], viaCriteria: [], viaJourneys: [] });
  });
});

describe("acceptance contract drift", () => {
  const criterion = "C.app.notes.save";
  const mutate = (fn: (node: any) => void) => {
    const node = parse(files.get(SAVE)!);
    fn(node);
    return load(new Map(files).set(SAVE, stringify(node)));
  };

  it("counts claim-only criterion changes as affected criteria", () => {
    const after = mutate(n => { n.criteria[0].claim = "A changed promise"; });
    expect(diffModels(base, after).affectedCriteria).toContain(criterion);
  });

  it.each(["inputs", "removal", "attachment"])("tracks %s changes through criterion.hooks in both revisions", change => {
    const after = mutate(n => {
      if (change === "inputs") n.criteria[0].hooks[0].inputs = { check: "changed" };
      if (change === "removal") n.criteria[0].hooks = [];
      if (change === "attachment") n.criteria[0].hooks.push({ ...n.criteria[0].hooks[0], id: "hook.additional" });
    });
    expect(diffModels(base, after).affectedCriteria).toContain(criterion);
    expect(diffModels(after, base).affectedCriteria).toContain(criterion);
  });

  it("tracks old and new hook.criteria links independently of criterion.hooks", () => {
    const standalone = (criteria: string[], check: string) => load(new Map(files).set("hook.external/node.yaml", stringify({
      id: "hook.external", kind: "hook", fields: { assay: "External", tier: "execution", engine: "vitest", criteria, triggers: ["submission"], inputs: { check } },
    })));
    const attached = standalone([criterion], "old");
    const changed = standalone([criterion], "new");
    const detached = standalone([], "old");
    expect(diffModels(attached, changed).affectedCriteria).toContain(criterion);
    expect(diffModels(attached, detached).affectedCriteria).toContain(criterion);
    expect(diffModels(detached, attached).affectedCriteria).toContain(criterion);
  });

  it("overlaps explicit criterion ids even when no affected set was supplied", () => {
    const after = mutate(n => { n.criteria[0].hooks[0].inputs = { check: "changed" }; });
    const scope = { added: [], removed: [], changed: [{ id: criterion, fields: [] }], affectedCriteria: [], affectedJourneys: [] };
    expect(overlap(diffModels(base, after), scope, base).viaCriteria).toContain(criterion);
  });
});
