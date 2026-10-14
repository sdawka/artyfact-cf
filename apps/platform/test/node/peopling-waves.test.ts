/** The Peopling demo shape under main's task analysis: goals and events are independent, the UI task follows both. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTasks, loadGenome, type SystemModel, type TaskDefinition } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";
import { taskFootprint } from "../../worker/tasks/footprint";

const root = join(__dirname, "../../../..");
const tracked = (dir: string) => execFileSync("git", ["ls-files", dir], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && existsSync(join(root, f)));
const genome = Object.fromEntries(tracked("examples/peopling-system").filter((f) => /\.ya?ml$/.test(f)).map((f) => [f.slice("examples/peopling-system/".length), readFileSync(join(root, f), "utf8")]));
const tree = tracked("examples/peopling-app").map((f) => f.slice("examples/peopling-app/".length));
const model: SystemModel = loadGenome(genome, { templates: metaTemplates });

const expand = (nodes: string[]) => [...new Set([...nodes, ...Object.keys(model.index.byId).filter((id) => nodes.some((n) => model.index.path(id).includes(n)))])];
/** Tasks as plan creation builds them: write nodes expanded to descendants, reads and dependencies derived from links. */
function define(specs: Record<string, string[]>): TaskDefinition[] {
  const rels = new Set(["invokes", "calls", "reads", "uses", "stepOperation"]);
  const tasks: TaskDefinition[] = Object.entries(specs).map(([id, w]) => ({ id, title: id, artifactId: "artifact.webapp", steps: ["implement"], dependsOn: [], readNodes: [], writeNodes: expand(w), checks: [], footprint: undefined as never }));
  for (const t of tasks) {
    const reads = t.writeNodes.flatMap((n) => (model.index.linksOut[n] ?? []).filter((l) => rels.has(l.rel)).map((l) => l.to));
    for (const o of tasks) if (o.id !== t.id && o.writeNodes.some((n) => reads.includes(n)) && !t.dependsOn.includes(o.id)) t.dependsOn.push(o.id);
    t.readNodes = [...new Set(reads)];
  }
  for (const t of tasks) t.footprint = taskFootprint(model, t.writeNodes, tree, t.artifactId, "app", t.readNodes);
  return tasks;
}

const goals = ["operation.goal.save"];
const events = ["entity.ContactEvent", "operation.contact.log"];
const ui = ["screen.goal", "screen.logContact", "screen.today", "component.TodayList", "affordance.Today.refresh"];

describe("Peopling evolution.2 tasks", () => {
  it("runs the goal and event tasks in one wave with no conflicts", () => {
    const a = analyzeTasks(define({ t1: goals, t2: events }));
    expect(a.conflicts).toEqual([]);
    expect(a.waves).toEqual([["t1", "t2"]]);
  });
  it("puts the UI task, which invokes both operations, in wave two", () => {
    const a = analyzeTasks(define({ t1: goals, t2: events, t3: ui }));
    expect(a.conflicts.map((c) => [c.kind, ...c.tasks])).toEqual([["dependency", "t1", "t3"], ["dependency", "t2", "t3"]]);
    expect(a.waves).toEqual([["t1", "t2"], ["t3"]]);
  });
});
