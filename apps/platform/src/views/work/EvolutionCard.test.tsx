import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Evolution, TaskPlanSummary } from "../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { ModelProvider } from "@/model/useModel";
import { testQueryClient } from "@/testing/render";
import { EvolutionCard } from "./EvolutionCard";

const base = fixtureBundle().model.evolutions[0]! as Evolution;
const plan = (p: Partial<TaskPlanSummary>): TaskPlanSummary => ({ tasks: 0, waves: 0, byStatus: {}, updatedAt: "", ...p });

function show(e: Evolution) {
  render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={["/s/system.peopling/r/head/work"]}>
        <ModelProvider bundle={fixtureBundle()}>
          <EvolutionCard evolution={e} selected={false} onSelect={() => {}} />
        </ModelProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.queryByTestId("plan-line")?.textContent;
}

describe("EvolutionCard plan line", () => {
  it("has none without a plan", () => expect(show({ ...base, state: "actionable" })).toBeUndefined());
  it("says a plan is ready", () =>
    expect(show({ ...base, state: "actionable", plan: plan({ tasks: 4, waves: 2, byStatus: { planned: 4 } }) })).toBe("plan ready · 4 tasks in 2 waves"));
  it("says a wave is running", () =>
    expect(show({ ...base, state: "realizing", plan: plan({ tasks: 3, waves: 1, byStatus: { realizing: 1, evaluated: 1, planned: 1 } }) })).toBe("wave running · 2 of 3 tasks"));
  it("says tasks await an agent", () =>
    expect(show({ ...base, state: "realizing", plan: plan({ tasks: 2, waves: 1, byStatus: { claimed: 1, planned: 1 } }) })).toBe("1 task awaits an agent"));
});
