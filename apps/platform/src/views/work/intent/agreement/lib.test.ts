import { describe, expect, it } from "vitest";
import type { ProposalPlanNode, ProposedOp } from "../../../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { PLAN_TREE, PLAN_TREE_OPS, planShape } from "../../../../../test/fixtures/plan-tree";
import { SAMPLE_PROPOSAL } from "../sample";
import { acceptSet, blockedBy, cascade, countsText, flatten, initialExpanded, planFromDelta, planFromOps, rollupPlan, uncoveredOps, walk } from "./lib";

const index = buildIndex(fixtureBundle());
const node = (id: string, opIds: string[], children: ProposalPlanNode[] = [], decision?: ProposalPlanNode["decision"]): ProposalPlanNode => ({
  id, kind: "node", title: id, path: [id], summary: "", opIds, children, ...(decision && { decision }),
});
// thing: a (op.a), b (op.b needs op.a), c (op.c)
const OPS: ProposedOp[] = [
  { id: "op.a", op: "add", node: "n.a", kind: "x", parent: "thing" },
  { id: "op.b", op: "link", node: "n.b", link: { rel: "references", to: "n.a" }, dependsOn: ["op.a"] },
  { id: "op.c", op: "update", node: "n.c", fields: { description: "x" } },
];
const PLAN = [node("thing", [], [node("n.a", ["op.a"]), node("n.b", ["op.b"]), node("n.c", ["op.c"])])];
const find = (plan: ProposalPlanNode[], id: string) => walk(plan).find((n) => n.id === id)!;

describe("agreement lib", () => {
  it("children inherit a parent decision; an explicit child decision overrides it and the parent is mixed", () => {
    let plan = cascade(PLAN, "thing", "agree");
    let r = rollupPlan(plan, OPS);
    expect(r.get("n.a")).toMatchObject({ effective: "agree", inherited: true, rollup: "agree" });
    expect(r.get("thing")).toMatchObject({ rollup: "agree", tally: { agree: 3, reject: 0, defer: 0, undecided: 0 } });
    plan = cascade(plan, "n.c", "defer");
    r = rollupPlan(plan, OPS);
    expect(r.get("n.c")).toMatchObject({ effective: "defer", inherited: false });
    expect(r.get("thing")).toMatchObject({ rollup: "mixed", tally: { agree: 2, defer: 1 } });
    expect(countsText(r.get("thing")!.changes)).toBe("1 add · 1 update · 1 link");
  });

  it("a parent decision clears its descendants' explicit decisions; null clears only the node", () => {
    let plan = cascade(cascade(PLAN, "n.a", "reject"), "n.b", "defer");
    plan = cascade(plan, "thing", "agree");
    expect(walk(plan).map((n) => n.decision)).toEqual(["agree", undefined, undefined, undefined]);
    plan = cascade(cascade(plan, "n.c", "reject"), "thing", null);
    expect(find(plan, "thing").decision).toBeUndefined();
    expect(find(plan, "n.c").decision).toBe("reject");
    expect(rollupPlan(plan, OPS).get("thing")).toMatchObject({ rollup: "mixed", tally: { undecided: 2, reject: 1 } });
    // The input is never mutated.
    expect(walk(PLAN).every((n) => !n.decision)).toBe(true);
  });

  it("an agreed op whose dependency is rejected or deferred is blocked and named by its node", () => {
    const plan = cascade(cascade(PLAN, "thing", "agree"), "n.a", "reject");
    const s = acceptSet(plan, OPS);
    expect(s.opIds).toEqual(["op.c"]);
    expect([...s.blocked]).toEqual([["op.b", ["op.a"]]]);
    expect(s.rejected).toEqual(["op.a"]);
    expect([...blockedBy(plan, OPS)]).toEqual([["n.b", ["n.a"]]]);
    expect([...blockedBy(cascade(plan, "n.a", "defer"), OPS)]).toEqual([["n.b", ["n.a"]]]);
  });

  it("the accept set is closed under withDependencies within agreed nodes and lists the undecided", () => {
    const chain: ProposedOp[] = [...OPS, { id: "op.d", op: "update", node: "n.d", dependsOn: ["op.b"] }];
    const plan = [node("thing", [], [...PLAN[0]!.children, node("n.d", ["op.d"])])];
    // op.d needs op.b needs op.a: rejecting op.a blocks both, transitively.
    let s = acceptSet(cascade(cascade(plan, "thing", "agree"), "n.a", "reject"), chain);
    expect(s.opIds).toEqual(["op.c"]);
    expect(s.blocked.get("op.d")).toEqual(["op.a"]);
    s = acceptSet(cascade(plan, "n.b", "agree"), chain);
    expect(s.opIds).toEqual([]);
    expect(s.undecided).toEqual(["op.a", "op.c", "op.d"]);
    s = acceptSet(cascade(plan, "thing", "agree"), chain);
    expect(s.opIds).toEqual(["op.a", "op.b", "op.c", "op.d"]);
  });

  it("finds ops no node owns", () => {
    expect(uncoveredOps(PLAN, [...OPS, { id: "op.x", op: "remove", node: "n.x" }]).map((o) => o.id)).toEqual(["op.x"]);
  });

  it("expands everything up to five op-owning nodes, else only the roots", () => {
    expect([...initialExpanded(PLAN)].sort()).toEqual(["n.a", "n.b", "n.c", "thing"]);
    const big = [node("thing", [], ["1", "2", "3", "4", "5", "6"].map((i) => node(`n.${i}`, [`op.${i}`])))];
    expect([...initialExpanded(big)]).toEqual(["thing"]);
    expect(flatten(big, new Set()).map((r) => r.node.id)).toEqual(["thing"]);
    expect(flatten(big, new Set(["thing"]))[6]).toMatchObject({ level: 2, parent: "thing", setSize: 6, posInSet: 6 });
  });

  it("builds the plan from ops and the model index: Thing roots, ancestors, adds under their parent, Other changes", () => {
    const plan = planFromOps([...SAMPLE_PROPOSAL.ops, { id: "op.9", op: "update", node: "nope.missing" }], index);
    expect(plan.map((n) => n.id)).toEqual(["thing.webapp", "other"]);
    const thing = plan[0]!;
    expect(thing).toMatchObject({ kind: "thing", path: ["system.peopling", "thing.webapp"], opIds: [], summary: "1 add · 1 update · 1 link" });
    const people = find(plan, "screen.people");
    expect(people.opIds).toEqual(["op.1"]);
    expect(people.path).toEqual(["system.peopling", "thing.webapp", "section.ui", "screen.people"]);
    const added = find(plan, "component.BirthdayField");
    expect(added).toMatchObject({ kind: "component", title: "Birthday field", opIds: ["op.2", "op.3"], summary: "1 add · 1 link" });
    expect(find(plan, "component.ContactCollection").children.map((c) => c.id)).toEqual(["component.BirthdayField"]);
    expect(plan[1]).toMatchObject({ title: "Other changes", opIds: ["op.9"] });
    expect(uncoveredOps(plan, SAMPLE_PROPOSAL.ops)).toEqual([]);
    // The sample's static plan is what planFromOps builds.
    expect(SAMPLE_PROPOSAL.plan).toEqual(planFromOps(SAMPLE_PROPOSAL.ops, index));
  });

  it("builds the tree the platform stores from the same ops (shared fixture with worker planOf)", () => {
    expect(planShape(planFromOps(PLAN_TREE_OPS, index))).toEqual(PLAN_TREE);
  });

  it("builds an amendment plan from a semantic delta", () => {
    const { plan, ops } = planFromDelta({
      changes: [
        { id: "screen.people", kind: "screen", before: { name: "People" }, after: { name: "People!" }, fieldsChanged: ["name"] },
        { id: "component.New", kind: "component", before: null, after: { name: "New", parent: "screen.people" }, fieldsChanged: [] },
      ],
    }, index);
    expect(ops.map((o) => o.op)).toEqual(["update", "add"]);
    expect(find(plan, "component.New")).toMatchObject({ title: "New", opIds: ["change.2"] });
    expect(plan[0]!.summary).toBe("1 add · 1 update");
  });
});
