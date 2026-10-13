import { describe, expect, it } from "vitest";
import { evaluate, loadTemplate, memoryStore, type Graph, type Readiness } from "../src/index.ts";
import { base, board, clean, edbLeaves } from "./fixture.ts";

type G = Graph;
const template = loadTemplate(board(), memoryStore([base()]));
const node = (g: G, id: string) => g.nodes.find((n) => n.id === id)!;
const fields = (g: G, id: string) => node(g, id).fields;
const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "card", parent: "b1", fields: { title: id, priority: 3, ...extra } });
const assign = (from: string, to = "p1", certainty?: string) => ({ from, rel: "assignedTo", to, ...(certainty && { certainty }) });

const cases: [pack: string, rule: string, level: string, subject: string, mutate: (g: G) => void][] = [
  ["metamodel@1", "graph.templateMismatch", "error", "template.other@1", (g) => { g.template = "template.other@1"; }],
  ["metamodel@1", "node.kindUnknown", "error", "x1", (g) => { g.nodes.push({ id: "x1", kind: "ticket", fields: {} }); }],
  ["metamodel@1", "node.duplicate", "error", "p1", (g) => { g.nodes.push({ id: "p1", kind: "board", fields: { title: "dup" } }); }],
  ["metamodel@1", "ref.dangling", "error", "b1", (g) => { fields(g, "b1").owner = "ghost"; }],
  ["metamodel@1", "ref.parentMissing", "error", "c1", (g) => { node(g, "c1").parent = "b404"; }],
  ["metamodel@1", "tree.cycle", "error", "b1", (g) => { node(g, "b1").parent = "c1"; }],
  ["metamodel@1", "tree.multiParent", "error", "c1", (g) => { g.nodes.push({ ...card("c1"), parent: "b2" }, { id: "b2", kind: "board", fields: { title: "B2" } }); }],
  ["metamodel@1", "tree.parentKind", "error", "c1", (g) => { node(g, "c1").parent = "c2"; }],
  ["metamodel@1", "link.sourceUnknown", "error", "ghost", (g) => { g.links.push({ from: "ghost", rel: "blocks", to: "c1" }); }],
  ["metamodel@1", "link.relationUnknown", "error", "c1", (g) => { g.links.push({ from: "c1", rel: "mentions", to: "c2" }); }],
  ["metamodel@1", "link.endpoint", "error", "b1", (g) => { g.links.push({ from: "b1", rel: "blocks", to: "c1" }); }],
  ["metamodel@1", "field.type", "error", "c1", (g) => { fields(g, "c1").priority = "high"; }],
  ["metamodel@1", "field.enum", "error", "b1", (g) => { fields(g, "b1").status = "archived"; }],
  ["metamodel@1", "field.unknown", "warning", "c1", (g) => { fields(g, "c1").colour = "red"; }],

  ["completeness@1", "field.required", "missing", "c1", (g) => { delete fields(g, "c1").title; }],
  ["completeness@1", "children.required", "missing", "b2", (g) => { g.nodes.push({ id: "b2", kind: "board", fields: { title: "Empty" } }); g.declarations.push({ scope: "b2", status: "complete" }); }],
  ["completeness@1", "relation.required", "missing", "c3", (g) => { g.nodes.push(card("c3")); }],
  ["completeness@1", "relation.minIn", "missing", "p2", (g) => { g.nodes.push({ id: "p2", kind: "person", fields: { handle: "p2" } }); }],
  ["completeness@1", "tree.parentRequired", "missing", "c3", (g) => { g.nodes.push({ id: "c3", kind: "card", fields: { title: "Loose" } }); g.links.push(assign("c3")); }],
  ["completeness@1", "scope.undeclared", "missing", "b1", (g) => { g.declarations = []; }],
  ["completeness@1", "node.provisional", "missing", "c2", (g) => { node(g, "c2").provisional = true; }],
  ["completeness@1", "exactlyOne.none", "missing", "p1", (g) => { delete fields(g, "p1").email; }],

  ["consistency@1", "relation.maxOut", "error", "c1", (g) => { g.nodes.push({ id: "p2", kind: "person", fields: { handle: "p2" } }); g.links.push(assign("c1", "p2")); }],
  ["consistency@1", "relation.maxIn", "error", "c1", (g) => { g.nodes.push(card("c3"), card("c4")); g.links.push(assign("c3"), assign("c4"), { from: "c2", rel: "blocks", to: "c1" }, { from: "c3", rel: "blocks", to: "c1" }, { from: "c4", rel: "blocks", to: "c1" }); }],
  ["consistency@1", "relation.requiredMax", "error", "c1", (g) => { g.nodes.push({ id: "p2", kind: "person", fields: { handle: "p2" } }); g.links.push(assign("c1", "p2")); }],
  ["consistency@1", "children.max", "error", "b1", (g) => { for (const id of ["c3", "c4", "c5", "c6"]) { g.nodes.push(card(id)); g.links.push(assign(id)); } }],
  ["consistency@1", "relation.cycle", "error", "c1", (g) => { g.links.push({ from: "c1", rel: "dependsOn", to: "c2" }, { from: "c2", rel: "dependsOn", to: "c1" }); g.links.splice(2, 1); }],
  ["consistency@1", "cycle.forbidden", "error", "c2", (g) => { g.links.push({ from: "c2", rel: "blocks", to: "c1" }); }],
  ["consistency@1", "constraint.incompatible", "error", "c1", (g) => { fields(g, "c1").archived = true; }],
  ["consistency@1", "relation.exclusive", "error", "c1", (g) => { g.links.push({ from: "c1", rel: "dependsOn", to: "c2" }); }],
  ["consistency@1", "exactlyOne.many", "error", "p1", (g) => { fields(g, "p1").handle = "pat"; }],
  ["consistency@1", "certainty.contradiction", "error", "c1", (g) => { g.nodes.push({ id: "p2", kind: "person", fields: { handle: "p2" } }); g.links.push(assign("c1", "p2", "observed")); }],

  ["board@1", "card.unprioritized", "warning", "c1", (g) => { delete fields(g, "c1").priority; }],
  ["board@1", "semantic:card.vague", "info", "c1", (g) => { fields(g, "c1").title = "Do stuff"; }],
];

const run = (mutate?: (g: G) => void): Readiness => { const g = clean(); mutate?.(g); return evaluate(template, g); };

describe("evaluate", () => {
  it("finds nothing on the clean graph", () => {
    const r = run();
    expect(r.findings).toEqual([]);
    expect(r.completeness).toEqual({ required: 11, satisfied: 11, missing: [] });
    expect(r).toMatchObject({ buildable: true, actionable: true, incomplete: false, consistency: { violations: 0 } });
    expect(r.template).toMatchObject({ ref: "template.test.board@1", hash: template.hash, form: { valid: true } });
    expect(r.packs.map((p) => `${p.id}@${p.version}`)).toEqual(["metamodel@1", "completeness@1", "consistency@1", "text@1", "board@1"]);
  });

  for (const [pack, rule, level, subject, mutate] of cases) {
    it(`${pack} ${rule} fires`, () => {
      const r = run(mutate);
      const hit = r.findings.find((f) => f.rule === rule && f.subject === subject);
      expect(hit, JSON.stringify(r.findings.map((f) => [f.rule, f.subject]))).toBeDefined();
      expect(hit!.level).toBe(level);
      expect(hit!.pack).toBe(pack);
      expect(hit!.message).not.toBe(rule.replace(/^semantic:/, ""));
      for (const f of r.findings) {
        expect(edbLeaves(f.derivation)).toBe(true);
        expect(f.facts.length).toBeGreaterThan(0);
      }
      expect(r.buildable).toBe(false);
    });
  }

  it("summarises completeness and consistency", () => {
    const r = run((g) => { delete fields(g, "c1").title; g.declarations = []; fields(g, "c1").archived = true; });
    expect(r.completeness).toEqual({ required: 11, satisfied: 9, missing: ["b1", "c1"] });
    expect(r.consistency.violations).toBe(1);
    expect(r.actionable).toBe(false);
  });

  it("is actionable but not buildable with only soft findings or open semantic candidates", () => {
    for (const m of [(g: G) => { delete fields(g, "c1").priority; }, (g: G) => { fields(g, "c1").title = "stuff"; }]) {
      const r = run(m);
      expect(r).toMatchObject({ actionable: true, buildable: false });
    }
  });

  it("is deterministic: the same inputs give byte-identical Readiness", () => {
    const messy = (g: G) => { delete fields(g, "c1").title; g.links.push({ from: "c2", rel: "blocks", to: "c1" }); fields(g, "p1").handle = "x"; };
    const a = JSON.stringify(run(messy));
    const b = JSON.stringify(evaluate(loadTemplate(board(), memoryStore([base()])), (() => { const g = clean(); messy(g); return g; })()));
    expect(b).toBe(a);
    expect(JSON.parse(a).findings.length).toBeGreaterThan(2);
  });
});
