import { describe, expect, it } from "vitest";
import { diff, diffFindings, evaluate, graphHash, loadTemplate, memoryStore, parseGraph } from "../src/index.ts";
import { base, board, clean } from "./fixture.ts";

describe("diff", () => {
  it("reports added, removed and changed nodes and links", () => {
    const a = clean(), b = clean();
    b.nodes = b.nodes.filter((n) => n.id !== "c2");
    b.nodes.push({ id: "c3", kind: "card", parent: "b1", fields: { title: "New", priority: 1, state: "open" } });
    b.nodes[1].fields.priority = 5;
    b.nodes[0].fields.status = "draft";
    b.links = [{ from: "c1", rel: "assignedTo", to: "p1", certainty: "observed" }, { from: "c3", rel: "assignedTo", to: "p1" }];
    expect(diff(a, b)).toEqual({
      nodes: { added: ["c3"], removed: ["c2"], changed: [{ id: "b1", fields: ["fields.status"] }, { id: "c1", fields: ["fields.priority"] }] },
      links: {
        added: [{ from: "c3", rel: "assignedTo", to: "p1" }],
        removed: [{ from: "c1", rel: "blocks", to: "c2" }, { from: "c2", rel: "assignedTo", to: "p1" }],
        changed: [{ from: "c1", rel: "assignedTo", to: "p1", certainty: [null, "observed"] }],
      },
    });
  });

  it("is empty for identical graphs and graphHash ignores order", () => {
    const a = clean(), b = clean();
    b.nodes.reverse(); b.links.reverse();
    expect(diff(a, b)).toEqual({ nodes: { added: [], removed: [], changed: [] }, links: { added: [], removed: [], changed: [] } });
    expect(graphHash(parseGraph(a))).toBe(graphHash(parseGraph(b)));
  });

  it("reports findings that appeared and resolved", () => {
    const t = loadTemplate(board(), memoryStore([base()]));
    const before = clean();
    before.nodes[1].fields.archived = true;
    const after = clean();
    delete after.nodes[1].fields.priority;
    const d = diffFindings(evaluate(t, before), evaluate(t, after));
    expect(d.appeared.map((f) => f.rule)).toEqual(["card.unprioritized"]);
    expect(d.resolved.map((f) => f.rule)).toEqual(["constraint.incompatible"]);
  });
});
