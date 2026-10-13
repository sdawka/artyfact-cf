import { describe, expect, it } from "vitest";
import { composeTemplates, loadTemplate, TemplateCompositionError, type TemplateInput } from "../src/index";

const screen = { fields: [{ name: "name", type: "string" }] };
const pack = (id: string, source = ".decl node(Id: sym, Kind: sym, Parent: sym)\n") => ({ id, version: "1", source });
const system = (extra: Partial<TemplateInput> = {}) => loadTemplate({
  id: "template.test.system", version: 1, meta: 1,
  kinds: { system: screen, screen },
  relations: { reads: { description: "System reads", from: ["screen"], to: ["screen"] } },
  rules: [pack("test.system")],
  criteria: [{ id: "C.named", owner: "system", subject: "system", severity: "hard" }],
  view: { layers: [{ id: "experience", label: "Experience" }, { id: "domain", label: "Domain" }] },
  ...extra,
} as TemplateInput);
const thing = (extra: Partial<TemplateInput> = {}) => loadTemplate({
  id: "template.test.thing", version: 1, meta: 1,
  kinds: { screen, entity: screen },
  relations: { reads: { description: "Thing reads", from: ["entity"], to: ["entity"] } },
  rules: [pack("test.thing")],
  nodes: [{ id: "section.$self", kind: "section", parent: "$self", fields: { name: "Section of $self" } }],
  view: { layers: [{ id: "data", label: "Data" }, { id: "domain", label: "Domain (thing)" }] },
  ...extra,
} as TemplateInput);

describe("composeTemplates", () => {
  it("unions kinds, relations, rules and criteria, keeping the System's ref", () => {
    const t = composeTemplates({ template: system() }, [{ template: thing(), self: "thing.a" }]);
    expect(t.ref).toBe("template.test.system@1");
    expect(Object.keys(t.kinds).sort()).toEqual(["entity", "screen", "system"]);
    expect(t.relations.reads).toMatchObject({ description: "System reads", from: ["screen", "entity"], to: ["screen", "entity"] });
    expect(t.rules.map((p) => p.id)).toEqual(["test.system", "test.thing"]);
    expect(t.criteria.map((c) => c.id)).toEqual(["C.named"]);
    expect(t.lineage).toEqual(expect.arrayContaining(["template.test.system@1", "template.test.thing@1"]));
  });

  it("puts the System's layers first, in its order, and appends the ones a Thing adds", () => {
    const t = composeTemplates({ template: system() }, [{ template: thing() }]);
    expect(t.view!.layers!.map((l) => [l.id, l.label])).toEqual([["experience", "Experience"], ["domain", "Domain"], ["data", "Data"]]);
  });

  it("instantiates prefilled nodes for each Thing that uses the template", () => {
    const t = composeTemplates({ template: system() }, [{ template: thing(), self: "thing.a" }, { template: thing(), self: "thing.b" }]);
    expect(t.nodes.map((n) => [n.id, n.parent])).toEqual([["section.thing.a", "thing.a"], ["section.thing.b", "thing.b"]]);
  });

  it("merges a template used twice and gives a stable hash", () => {
    const once = composeTemplates({ template: system() }, [{ template: thing() }]);
    const twice = composeTemplates({ template: system() }, [{ template: thing() }, { template: thing() }]);
    expect(twice.hash).toBe(once.hash);
    expect(once.hash).not.toBe(system().hash);
  });

  it("rejects a kind, rule pack or relation declared differently by two templates", () => {
    const kind = thing({ kinds: { screen: { fields: [{ name: "title", type: "string" }] } } });
    expect(() => composeTemplates({ template: system() }, [{ template: kind }])).toThrow(TemplateCompositionError);
    expect(() => composeTemplates({ template: system() }, [{ template: kind }])).toThrow(/kind screen/);
    const rules = thing({ rules: [pack("test.system", ".decl other(X: sym)\n")] });
    expect(() => composeTemplates({ template: system() }, [{ template: rules }])).toThrow(/rule pack test.system/);
    const rel = thing({ relations: { reads: { from: ["entity"], to: ["entity"], acyclic: true } } });
    expect(() => composeTemplates({ template: system() }, [{ template: rel }])).toThrow(/relation reads/);
  });
});
