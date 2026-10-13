import { describe, expect, it } from "vitest";
import type { Evolution, TaskPlanSummary } from "../../../../shared/api";
import { planLine, taskSignals } from "./signals";

const evo = (state: Evolution["state"], plan?: Partial<TaskPlanSummary>): Evolution =>
  ({ id: "evolution.1", state, ...(plan && { plan: { tasks: 0, waves: 0, byStatus: {}, updatedAt: "", ...plan } }) }) as Evolution;

describe("taskSignals", () => {
  it("is empty without a plan", () => {
    expect(taskSignals(evo("actionable"))).toEqual({ tasks: 0, waves: 0, planReady: false, awaitingAgent: 0, running: 0, done: 0 });
    expect(planLine(taskSignals(evo("actionable")))).toBeUndefined();
  });

  it("is ready when every task is planned and the Evolution can be worked", () => {
    const plan = { tasks: 4, waves: 2, byStatus: { planned: 4 } };
    for (const s of ["genome-approved", "actionable", "realizing"] as const) expect(taskSignals(evo(s, plan)).planReady).toBe(true);
    for (const s of ["proposed", "promoted", "rejected", "withdrawn"] as const) expect(taskSignals(evo(s, plan)).planReady).toBe(false);
    expect(taskSignals(evo("actionable", { ...plan, tasks: 0, byStatus: {} })).planReady).toBe(false);
  });

  it("is not ready once any task has moved", () => {
    expect(taskSignals(evo("actionable", { tasks: 4, waves: 2, byStatus: { planned: 3, claimed: 1 } })).planReady).toBe(false);
    expect(taskSignals(evo("actionable", { tasks: 2, waves: 1, byStatus: { planned: 1, rejected: 1 } })).planReady).toBe(false);
    expect(taskSignals(evo("actionable", { tasks: 2, waves: 1, byStatus: { planned: 2, claimed: 0 } })).planReady).toBe(true);
  });

  it("counts claimed, running and promoted tasks", () => {
    const s = taskSignals(evo("realizing", { tasks: 6, waves: 2, byStatus: { claimed: 1, realizing: 2, evaluated: 1, promoted: 2 } }));
    expect(s).toMatchObject({ tasks: 6, waves: 2, awaitingAgent: 1, running: 3, done: 2, planReady: false });
  });

  it("does not invent fields the summary cannot give", () => {
    expect(taskSignals(evo("realizing", { tasks: 1, waves: 1, byStatus: { realizing: 1 } }))).not.toHaveProperty("blocked");
  });
});

describe("planLine", () => {
  it("words each state", () => {
    expect(planLine(taskSignals(evo("actionable", { tasks: 4, waves: 2, byStatus: { planned: 4 } })))).toBe("plan ready · 4 tasks in 2 waves");
    expect(planLine(taskSignals(evo("actionable", { tasks: 1, waves: 1, byStatus: { planned: 1 } })))).toBe("plan ready · 1 task in 1 wave");
    expect(planLine(taskSignals(evo("realizing", { tasks: 3, waves: 1, byStatus: { realizing: 1, evaluated: 1, planned: 1 } })))).toBe("wave running · 2 of 3 tasks");
    expect(planLine(taskSignals(evo("realizing", { tasks: 3, waves: 1, byStatus: { claimed: 1, planned: 2 } })))).toBe("1 task awaits an agent");
    expect(planLine(taskSignals(evo("realizing", { tasks: 3, waves: 1, byStatus: { claimed: 2, planned: 1 } })))).toBe("2 tasks await an agent");
  });
});
