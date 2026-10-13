import { describe, expect, it } from "vitest";
import { ARTYFACT_GENOME, parseTree } from "@artyfact/ontology";
import { fromGraph, LegacyGenomeError, loadGenome, ModelParseError } from "../src/index";
import { edit, load, pathOf, readTree, store, SYSTEM_TEMPLATE, THING_TEMPLATE } from "./helpers";

const files = readTree();

describe("loadGenome", () => {
  it("refuses a v1 layout with LegacyGenomeError", () => {
    const v1 = new Map([["system.yaml", "id: system.old\nname: Old\n"], ["kits.yaml", "kits: []\n"]]);
    const e = (() => { try { loadGenome(v1, { templates: store() }); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(LegacyGenomeError);
    expect((e as LegacyGenomeError).code).toBe("legacy-genome");
  });

  it("reports tree errors as ModelParseError naming the file", () => {
    const f = new Map(files).set("thing.app/section.ui/screen.dup/node.yaml", "id: screen.list\nkind: screen\nfields: {name: Dup}\n");
    expect(() => load(f)).toThrow(ModelParseError);
    const bad = edit(files, "node.yaml", "kind: system", "kind: [system");
    const e = (() => { try { load(bad); } catch (x) { return x as ModelParseError; } })()!;
    expect(e).toBeInstanceOf(ModelParseError);
    expect(e.file).toBe("node.yaml");
  });

  it("names both Things and the id when two uses of a fixed-id template clash", () => {
    const fixed = {
      id: "template.thing.fixed", version: 1, meta: 1, extends: ARTYFACT_GENOME,
      nodes: [
        { id: "template.thing.fixed@1", kind: "template", fields: { kind: "thing", version: "1", name: "Fixed" } },
        { id: "section.panel", kind: "section", parent: "$self", fields: { name: "Panel" } },
      ],
    };
    const thing = (id: string) => `id: ${id}\nkind: thing\ntemplate: template.thing.fixed@1\nfields:\n  name: ${id}\n`;
    const two = new Map(files).set("thing.a/node.yaml", thing("thing.a")).set("thing.b/node.yaml", thing("thing.b"));
    const e = (() => { try { load(two, store(fixed)); } catch (x) { return x as ModelParseError; } })()!;
    expect(e).toBeInstanceOf(ModelParseError);
    expect(e.code).toBe("template-composition");
    expect(e.message).toContain("thing.a and thing.b both prefill node section.panel, differently");
  });

  it("maps every node, criterion, hook and change record to the file that declares it", () => {
    const m = load();
    expect(m.origin["system.mini"]).toBe("node.yaml");
    expect(m.origin["screen.list"]).toBe("thing.app/section.ui/screen.list/node.yaml");
    expect(m.origin["C.app.notes.save"]).toBe(pathOf(files, "affordance.NoteForm.save"));
    expect(m.origin["hook.app.notes.save"]).toBe(pathOf(files, "affordance.NoteForm.save"));
    expect(m.origin["J.notes/s1"]).toBe("thing.app/J.notes/s1/node.yaml");
    expect(m.origin["evolution.1"]).toBe("evolutions/evolution.1.yaml");
  });

  it("projects the System, Things, kits and journeys from the graph", () => {
    const m = load();
    expect(m.system).toMatchObject({ id: "system.mini", name: "Mini Notes", template: SYSTEM_TEMPLATE, things: ["thing.app"], purposes: ["P1"] });
    expect(m.things.map((t) => [t.id, t.templateRef, t.sections, t.artifacts.map((a) => a.artifact)]))
      .toEqual([["thing.app", THING_TEMPLATE, ["section.ui", "section.domain"], ["artifact.app"]]]);
    expect(m.kits.required).toEqual(["privacy", "auth"]);
    expect(m.kits.rulePacks.map((p) => p.id)).toContain("topology.private-pairs");
    expect(m.journeys[0]!.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "e1"]);
    expect(m.journeys[0]!.steps.find((s) => s.id === "s3")).toMatchObject({ screen: "screen.edit", operation: "operation.note.save" });
  });

  it("lists the pinned templates, System first, and composes them into the evaluated template", () => {
    const m = load();
    expect(m.templates.map((t) => `${t.id}@${t.version}`)).toEqual([SYSTEM_TEMPLATE, THING_TEMPLATE]);
    expect(m.templates[1]).toMatchObject({ sections: ["section.ui", "section.domain"] });
    expect(m.template.ref).toBe(SYSTEM_TEMPLATE);
    expect(m.graph.template).toBe(SYSTEM_TEMPLATE);
    expect(m.template.rules.map((p) => p.id)).toEqual(expect.arrayContaining(["artyfact.readiness", "artyfact.authorization"]));
  });

  it("re-projects the same model from its graph", () => {
    const m = load();
    const again = fromGraph(m.graph, store(), parseTree(files), m.revision);
    expect(again.nodes).toEqual(m.nodes);
    expect(again.criteria).toEqual(m.criteria);
  });

  it("keeps the revision it was loaded at", () => {
    expect(loadGenome(files, { templates: store(), revision: "abc" }).revision).toBe("abc");
  });
});
