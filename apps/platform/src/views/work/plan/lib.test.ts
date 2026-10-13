import { describe, expect, it } from "vitest";
import type { Task, TaskPlan } from "../../../../shared/api";
import {
  FIXTURE_REASON, blockedOn, canMerge, canPlan, canSplit, canStartWave, conflictReports, displayStatus, footprintLine, mergeTasks,
  planCounts, planUpdate, splitTask, whyWave,
} from "./lib";
import { SAMPLE_PLAN } from "./sample";

const evo = { id: "evolution.1", state: "actionable" as const };
const ctx = { fixture: false, evolution: evo };
const withStatus = (plan: TaskPlan, s: Record<string, Task["status"]>): TaskPlan => ({ ...plan, tasks: plan.tasks.map((t) => (s[t.id] ? { ...t, status: s[t.id]! } : t)) });

describe("plan lib", () => {
  it("counts tasks and waves", () => {
    expect(planCounts(SAMPLE_PLAN)).toBe("4 tasks · 2 waves");
    expect(footprintLine(SAMPLE_PLAN.tasks[1]!)).toBe("3 files · 1 entry");
  });

  it("explains each wave from dependencies and file overlaps", () => {
    expect(whyWave(SAMPLE_PLAN, "task.1")).toBe("Wave 1: it depends on no other task and shares no files with “People screen”.");
    expect(whyWave(SAMPLE_PLAN, "task.3")).toBe("Wave 2 because it edits src/worker/routes/contacts.ts also in “Contact storage” (wave 1).");
    const four = whyWave(SAMPLE_PLAN, "task.4");
    expect(four).toContain("it depends on “Contact storage” (wave 1)");
    expect(four).toContain("public/people/add-contact-dialog.js also in “People screen” (wave 1)");
    expect(whyWave(SAMPLE_PLAN, "task.nope")).toBe("This task is in no wave yet.");
  });

  it("gives canStartWave reasons: fixture, state, nothing planned, earlier wave open", () => {
    expect(canStartWave(SAMPLE_PLAN, 1, { fixture: true, evolution: evo })).toBe(FIXTURE_REASON);
    expect(canStartWave(SAMPLE_PLAN, 1, { fixture: false, evolution: { id: "evolution.1", state: "proposed" } })).toMatch(/is proposed; it must be actionable/);
    expect(canStartWave(SAMPLE_PLAN, 1, ctx)).toBeNull();
    expect(canStartWave(SAMPLE_PLAN, 2, ctx)).toMatch(/^Wave 1 is not promoted yet: “Contact storage” is planned, “People screen” is planned\.$/);
    const claimed = withStatus(SAMPLE_PLAN, { "task.1": "claimed", "task.2": "claimed" });
    expect(canStartWave(claimed, 1, ctx)).toBe("Every task in wave 1 has started; none is planned.");
    const done = withStatus(SAMPLE_PLAN, { "task.1": "promoted", "task.2": "abandoned" });
    expect(canStartWave(done, 2, ctx)).toBeNull();
  });

  it("canPlan needs the API and an approved Evolution", () => {
    expect(canPlan({ fixture: true, evolution: evo })).toBe(FIXTURE_REASON);
    expect(canPlan({ fixture: false, evolution: { id: "evolution.2", state: "proposed" } })).toMatch(/must be approved/);
    expect(canPlan(ctx)).toBeNull();
  });

  it("derives blocked from dependencies that are not promoted", () => {
    const t4 = SAMPLE_PLAN.tasks[3]!;
    expect(blockedOn(t4, SAMPLE_PLAN)).toEqual(["task.1"]);
    expect(displayStatus(t4, SAMPLE_PLAN)).toBe("blocked");
    expect(displayStatus(t4, withStatus(SAMPLE_PLAN, { "task.1": "promoted" }))).toBe("planned");
    expect(displayStatus({ ...t4, status: "claimed" }, SAMPLE_PLAN)).toBe("claimed");
  });

  it("merges tasks into the first, uniting nodes and criteria and repointing dependencies", () => {
    expect(canMerge(SAMPLE_PLAN.tasks, ["task.1"])).toMatch(/two or more/);
    expect(canMerge(withStatus(SAMPLE_PLAN, { "task.2": "claimed" }).tasks, ["task.1", "task.2"])).toMatch(/“People screen” is claimed/);
    expect(canMerge(SAMPLE_PLAN.tasks, ["task.1", "task.3"])).toBeNull();
    const out = mergeTasks(SAMPLE_PLAN.tasks, ["task.3", "task.1"]);
    expect(out.map((t) => t.id)).toEqual(["task.1", "task.2", "task.4"]);
    const m = out[0]!;
    expect(m.title).toBe("Contact storage + Owner-only access");
    expect(m.nodes).toEqual(["entity.ContactRecord", "policy.ownerOnly"]);
    expect(m.acceptanceCriteria).toEqual(["C.webapp.contact.storage", "C.webapp.private.owner"]);
    expect(m.origin).toBe("user");
    expect(out[2]!.dependsOn).toEqual(["task.1"]);
    // Merging a task with its dependency drops the self-edge.
    const self = mergeTasks(SAMPLE_PLAN.tasks, ["task.1", "task.4"]);
    expect(self[0]!.dependsOn).toEqual([]);
  });

  it("splits nodes into a new task after the original; dependents depend on both", () => {
    const t2 = SAMPLE_PLAN.tasks[1]!;
    expect(canSplit(t2, [])).toMatch(/Pick the nodes/);
    expect(canSplit(t2, t2.nodes)).toMatch(/at least one node/);
    expect(canSplit(SAMPLE_PLAN.tasks[0]!, ["entity.ContactRecord"])).toMatch(/one node/);
    expect(canSplit({ ...t2, status: "realizing" }, ["section.ui"])).toMatch(/is realizing/);
    const withDependent = SAMPLE_PLAN.tasks.map((t) => (t.id === "task.4" ? { ...t, dependsOn: ["task.2"] } : t));
    const out = splitTask(withDependent, "task.2", ["section.ui"], "UI section");
    expect(out.map((t) => t.id)).toEqual(["task.1", "task.2", "task.2-2", "task.3", "task.4"]);
    expect(out[1]!.nodes).toEqual(["screen.people"]);
    expect(out[2]).toMatchObject({ title: "UI section", nodes: ["section.ui"], status: "planned", origin: "user" });
    expect(out[4]!.dependsOn).toEqual(["task.2", "task.2-2"]);
    expect(splitTask(SAMPLE_PLAN.tasks, "task.2", [])).toEqual(SAMPLE_PLAN.tasks);
  });

  it("planUpdate drops footprints so the server recomputes them", () => {
    const body = planUpdate(SAMPLE_PLAN.tasks);
    expect(body.tasks).toHaveLength(4);
    expect(body.tasks.every((t) => !("footprint" in t))).toBe(true);
  });

  it("adapts task conflicts to ConflictChips rows naming the other task", () => {
    const title = (id: string) => SAMPLE_PLAN.tasks.find((t) => t.id === id)?.title ?? id;
    const rows = conflictReports(SAMPLE_PLAN.conflicts, "task.4", title);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "declared", with: "Contact storage", candidates: ["Contact storage"], paths: [] }),
      expect.objectContaining({ kind: "file", with: "People screen", paths: ["public/people/add-contact-dialog.js"], subjects: [] }),
    ]);
    expect(conflictReports(SAMPLE_PLAN.conflicts, "task.2", title).map((r) => r.with)).toEqual(["Save a contact"]);
  });
});
