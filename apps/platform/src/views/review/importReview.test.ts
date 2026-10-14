import { describe, expect, it } from "vitest";
import type { ProposalPlanNode } from "../../../shared/api";
import { cascade } from "../work/intent/agreement";
import { acceptImportBlocker, decidedTree, importDecisions, importSummary } from "./importReview";

const node = (id: string, children: ProposalPlanNode[] = [], path: string[] = [id]): ProposalPlanNode =>
  ({ id, kind: "node", title: id.toUpperCase(), path, summary: "", opIds: [], children });
const tree = [node("thing.a", [node("section.a1", [node("GD.prompts")]), node("section.a2")]), node("thing.b")];
const title = (id: string) => id.toUpperCase();

describe("importDecisions", () => {
  it("lists every node undecided at first and blocks accept with the count", () => {
    const d = importDecisions(tree);
    expect(d).toMatchObject({ total: 5, agreed: 0, rejected: [], orphaned: [] });
    expect(d.undecided).toHaveLength(5);
    expect(acceptImportBlocker(d, title)).toMatch(/^5 nodes are undecided/);
    expect(importSummary(d)).toBe("5 nodes: 0 agreed · 0 rejected · 5 undecided");
  });

  it("decides a Thing for everything under it; a rejected child is effectively rejected and sent", () => {
    let p = cascade(tree, "thing.a", "agree");
    p = cascade(p, "thing.b", "agree");
    p = cascade(p, "GD.prompts", "reject");
    const d = importDecisions(p);
    expect(d).toMatchObject({ total: 5, agreed: 4, rejected: ["GD.prompts"], undecided: [], orphaned: [] });
    expect(acceptImportBlocker(d, title)).toBeNull();
    expect(importSummary(d)).toBe("5 nodes: 4 agreed · 1 rejected");
  });

  it("sends every effectively rejected node, inherited ones included", () => {
    let p = cascade(tree, "thing.a", "reject");
    p = cascade(p, "thing.b", "agree");
    expect(importDecisions(p).rejected).toEqual(["thing.a", "section.a1", "GD.prompts", "section.a2"]);
  });

  it("blocks accept when an agreed node sits under a rejected one (its removal would take it too)", () => {
    let p = cascade(tree, "thing.a", "reject");
    p = cascade(p, "thing.b", "agree");
    p = cascade(p, "section.a1", "agree");
    const d = importDecisions(p);
    expect(d.orphaned).toEqual([{ node: "section.a1", under: "thing.a" }, { node: "GD.prompts", under: "thing.a" }]);
    expect(acceptImportBlocker(d, title)).toMatch(/^SECTION\.A1 is agreed but sits under rejected THING\.A/);
  });
});

describe("decidedTree", () => {
  it("shows an accepted review's outcome: roots agreed, the recorded rejections rejected", () => {
    const d = importDecisions(decidedTree({ tree, rejectedNodes: ["thing.b", "GD.prompts"] }));
    expect(d).toMatchObject({ agreed: 3, rejected: ["GD.prompts", "thing.b"], undecided: [], orphaned: [] });
  });
});
