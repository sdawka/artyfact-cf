import { describe, expect, it } from "vitest";
import { loadSystem, ModelParseError } from "../src/index";
import { edit, miniTemplateYaml, readTree, store } from "./helpers";

const count = (xs: { kind: string }[], kind: string) => xs.filter((n) => n.kind === kind).length;

describe("loadSystem", () => {
  const files = readTree();
  const m = loadSystem(files, { revision: "abc123", templates: store() });

  it("loads every collection", () => {
    expect(m.revision).toBe("abc123");
    expect(m.system.id).toBe("system.mini");
    expect(m.things.map((t) => t.id)).toEqual(["thing.app"]);
    expect(count(m.nodes, "screen")).toBe(2);
    expect(count(m.nodes, "component")).toBe(4); // 3 instance + AppShell from the template
    expect(count(m.nodes, "entity")).toBe(2);
    expect(count(m.nodes, "operation")).toBe(2);
    expect(count(m.nodes, "policy")).toBe(1);
    expect(count(m.nodes, "section")).toBe(2);
    expect(m.purposes.map((p) => p.id)).toEqual(["P1"]);
    expect(m.externals).toHaveLength(2);
    expect(m.claims).toHaveLength(1);
    expect(m.requirements).toHaveLength(1);
    expect(m.criteria.map((c) => c.id).sort()).toEqual(["C.app.exists", "C.app.notes.save", "C.system.structure"]);
    expect(m.hooks).toHaveLength(3);
    expect(m.journeys.map((j) => j.id)).toEqual(["J.notes"]);
    expect(m.evolutions.map((e) => e.id)).toEqual(["evolution.1"]);
    expect(m.description?.features.map((f) => f.id)).toEqual(["GD.notes"]);
    expect(m.kits).toEqual([{ id: "privacy", version: "1.0.0", required: true }]);
  });

  it("flattens nested ontology children and stamps owningThing", () => {
    const save = m.index.byId["affordance.NoteForm.save"].item as (typeof m.nodes)[number];
    expect(save.parent).toBe("component.NoteForm");
    expect(save.owningThing).toBe("thing.app");
    expect((m.index.byId["screen.list"].item as (typeof m.nodes)[number]).parent).toBe("section.ui");
  });

  it("accepts a bare list or a single object in list files", () => {
    const f = edit(files, "theory.yaml", /^claims:\n/, "");
    expect(loadSystem(f, { templates: store() }).claims).toHaveLength(1);
  });

  it("throws ModelParseError with the file and issues for a bad file", () => {
    const bad = edit(files, "journeys/J.notes.yaml", "actor: user", "actor: robot");
    try {
      loadSystem(bad, { templates: store() });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ModelParseError);
      expect((e as ModelParseError).file).toBe("journeys/J.notes.yaml");
      expect((e as ModelParseError).issues[0].path).toContain("actor");
    }
  });

  it("throws ModelParseError on invalid YAML and on a missing system.yaml", () => {
    expect(() => loadSystem(new Map(files).set("kits.yaml", "kits: [\n"), { templates: store() })).toThrow(ModelParseError);
    const noSystem = new Map(files);
    noSystem.delete("system.yaml");
    expect(() => loadSystem(noSystem, { templates: store() })).toThrow(/system\.yaml/);
  });

  it("throws on duplicate ids across files", () => {
    const dup = edit(files, "things/app/spec.yaml", "id: S.app.notes", "id: S.app.notes\n    thing: thing.app\n    title: dup\n    text: dup\n  - id: S.app.notes");
    expect(() => loadSystem(dup, { templates: store() })).toThrow(/duplicate id S\.app\.notes/);
  });

  it("is independent of file order", () => {
    const reversed = new Map([...files].reverse());
    const r = loadSystem(reversed, { templates: store() });
    expect(r.nodes.map((n) => n.id)).toEqual(m.nodes.map((n) => n.id));
  });
});

describe("template resolution", () => {
  const files = readTree();
  const m = loadSystem(files, { templates: store() });
  const node = (id: string) => m.nodes.find((n) => n.id === id)!;

  it("stamps fromTemplate on template nodes, criteria and hooks", () => {
    expect(node("component.AppShell").fromTemplate).toBe("template.thing.mini-webapp@1");
    expect(node("section.domain").fromTemplate).toBe("template.thing.mini-webapp@1");
    expect(m.criteria.find((c) => c.id === "C.app.exists")!.fromTemplate).toBe("template.thing.mini-webapp@1");
    expect(m.hooks.find((h) => h.id === "hook.app.exists")!.fromTemplate).toBe("template.thing.mini-webapp@1");
    expect(node("screen.list").fromTemplate).toBeUndefined();
  });

  it("rebases $thing to the instantiating Thing", () => {
    expect(node("section.domain").parent).toBe("thing.app");
    expect(node("section.domain").owningThing).toBe("thing.app");
    expect(node("component.AppShell").owningThing).toBe("thing.app");
    const exists = m.criteria.find((c) => c.id === "C.app.exists")!;
    expect([exists.ownerId, exists.subjectId]).toEqual(["thing.app", "thing.app"]);
  });

  it("lets instance objects override template objects with the same id", () => {
    expect(node("section.ui").name).toBe("Notes UI");
    expect(node("section.ui").fromTemplate).toBeUndefined();
    expect(node("section.ui").parent).toBe("thing.app");
    expect(m.nodes.filter((n) => n.id === "section.ui")).toHaveLength(1);
  });

  it("puts template objects before instance objects", () => {
    expect(m.nodes.findIndex((n) => n.id === "component.AppShell")).toBeLessThan(m.nodes.findIndex((n) => n.id === "screen.list"));
  });

  it("throws ModelParseError for a missing template", () => {
    expect(() => loadSystem(files)).toThrow(ModelParseError);
    const other = edit(files, "things/app/thing.yaml", "mini-webapp@1", "mini-webapp@2");
    try {
      loadSystem(other, { templates: store() });
      expect.unreachable();
    } catch (e) {
      expect((e as ModelParseError).file).toBe("things/app/thing.yaml");
      expect((e as ModelParseError).message).toContain("template.thing.mini-webapp@2");
    }
  });

  it("resolves a system template", () => {
    const sysTpl = `
id: template.system.mini
kind: system
version: "1"
name: Mini system
sections: [section.theory]
criteria:
  - { id: C.system.purpose, title: Purpose, claim: c, ownerKind: system, ownerId: $system, subjectKind: system, subjectId: $system, targetKind: model, gates: [submission] }
`;
    const f = edit(files, "system.yaml", "template: null", "template: template.system.mini@1");
    const r = loadSystem(f, { templates: store(miniTemplateYaml, sysTpl) });
    const c = r.criteria.find((x) => x.id === "C.system.purpose")!;
    expect(c).toMatchObject({ ownerId: "system.mini", subjectId: "system.mini", fromTemplate: "template.system.mini@1" });
    expect(r.templates.map((t) => `${t.id}@${t.version}`).sort()).toEqual(["template.system.mini@1", "template.thing.mini-webapp@1"]);
    expect(() => loadSystem(f, { templates: store() })).toThrow(/template\.system\.mini@1/);
  });
});
