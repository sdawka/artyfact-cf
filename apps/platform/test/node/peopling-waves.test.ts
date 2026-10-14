/** The Peopling demo shape under main's task analysis: goals and events are independent, the UI task follows both. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTasks, loadGenome, type SystemModel, type TaskDefinition } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";
import type { SystemManifest } from "../../shared/api";
import { taskDefinitions } from "../../worker/tasks/definitions";

const root = join(__dirname, "../../../..");
const tracked = (dir: string) => execFileSync("git", ["ls-files", dir], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && existsSync(join(root, f)));
const genome = Object.fromEntries(tracked("examples/peopling-system").filter((f) => /\.ya?ml$/.test(f)).map((f) => [f.slice("examples/peopling-system/".length), readFileSync(join(root, f), "utf8")]));
const tree = tracked("examples/peopling-app").map((f) => f.slice("examples/peopling-app/".length));
const model: SystemModel = loadGenome(genome, { templates: metaTemplates });

const manifest: SystemManifest = { genomeCommit: "g", artifacts: { "artifact.webapp": { repo: "app", commit: "a" } }, templateVersions: {}, hookVersions: {} };
/** Tasks exactly as plan creation builds them (`taskDefinitions`, shared with create and the plan draft). */
const define = (specs: Record<string, string[]>): TaskDefinition[] =>
  taskDefinitions(model, manifest, { "artifact.webapp": tree }, Object.entries(specs).map(([id, w]) => ({ id, title: id, artifactId: "artifact.webapp", steps: ["implement"], dependsOn: [], readNodes: [], writeNodes: w, checks: [] })));

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
