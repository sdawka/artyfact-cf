import type { ProposalPlanNode, ProposedOp } from "../../shared/api";

/**
 * Ops on the Peopling Genome (examples/peopling-system) whose agreement tree the platform (`planOf`, worker/intents.ts)
 * and the SPA fallback (`planFromOps`, src/views/work/intent/agreement/lib.ts) must both build as `PLAN_TREE`:
 * Thing roots, a node outside every Thing under the System root, an add without a parent under the System root, and
 * an unknown node under Other changes.
 */
export const PLAN_TREE_OPS: ProposedOp[] = [
  { id: "op.1", op: "update", node: "screen.people", fields: { description: "Revised" } },
  { id: "op.2", op: "add", node: "component.BirthdayField", kind: "component", parent: "component.ContactCollection", fields: { title: "Birthday field" } },
  { id: "op.3", op: "link", node: "component.BirthdayField", link: { rel: "references", to: "screen.people" }, dependsOn: ["op.2"] },
  { id: "op.4", op: "update", node: "GD.goals", fields: { description: "Revised" } },
  { id: "op.5", op: "add", node: "component.Orphan", kind: "component", fields: { title: "Orphan" } },
  { id: "op.6", op: "update", node: "nope.missing", fields: { description: "?" } },
];

/** The tree without titles (the platform names nodes by its template's title field, the SPA by the index). */
export type PlanShape = Pick<ProposalPlanNode, "id" | "kind" | "path" | "opIds" | "summary"> & { children: PlanShape[] };
export const planShape = (plan: ProposalPlanNode[]): PlanShape[] =>
  plan.map((n) => ({ id: n.id, kind: n.kind, path: n.path, opIds: n.opIds, summary: n.summary, children: planShape(n.children) }));

const S = "system.peopling";
const n = (id: string, kind: string, path: string[], summary: string, opIds: string[], children: PlanShape[] = []): PlanShape => ({ id, kind, path, opIds, summary, children });
const ui = [S, "thing.webapp", "section.ui"];

export const PLAN_TREE: PlanShape[] = [
  n("thing.webapp", "thing", [S, "thing.webapp"], "1 add · 1 update · 1 link", [], [
    n("section.ui", "section", ui, "1 add · 1 update · 1 link", [], [
      n("screen.people", "screen", [...ui, "screen.people"], "1 add · 1 update · 1 link", ["op.1"], [
        n("component.ContactCollection", "component", [...ui, "screen.people", "component.ContactCollection"], "1 add · 1 link", [], [
          n("component.BirthdayField", "component", [...ui, "screen.people", "component.ContactCollection", "component.BirthdayField"], "1 add · 1 link", ["op.2", "op.3"]),
        ]),
      ]),
    ]),
  ]),
  n(S, "system", [S], "1 add · 1 update", [], [
    n("GD.goals", "feature", [S, "GD.goals"], "1 update", ["op.4"]),
    n("component.Orphan", "component", [S, "component.Orphan"], "1 add", ["op.5"]),
  ]),
  n("other", "other", [], "1 update", ["op.6"]),
];
