import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { SYSTEM, evaluation, realization } from "@/views/work/testData";

const open = async (focus: string, tab: string, seed: Parameters<typeof renderApp>[2]) => {
  renderApp(`/s/${SYSTEM}/r/head/overview?focus=${focus}`, undefined, seed);
  const inspector = await screen.findByRole("complementary", { name: "Inspector" });
  act(() => within(inspector).getByRole("tab", { name: tab }).click());
  return inspector;
};

describe("Changes tab", () => {
  it("lists realizations touching the node with status", async () => {
    const inspector = await open("screen.people", "Changes", (qc) =>
      qc.setQueryData(qk.evolutions(SYSTEM), { evolutions: fixtureBundle().model.evolutions, realizations: [realization({ status: "evaluating", candidate: "cand.1" })] }),
    );
    await waitFor(() => expect(within(inspector).getByRole("link", { name: "realization.1" })).toBeTruthy());
    expect(within(inspector).getByText(/evaluating/)).toBeTruthy();
    expect(within(inspector).getAllByRole("link", { name: "Open in Work" }).length).toBeGreaterThan(0);
  });

  it("says when nothing touches the node", async () => {
    const inspector = await open("section.purpose", "Changes", undefined);
    expect(await within(inspector).findByText("No evolutions touch this object.")).toBeTruthy();
  });
});

describe("Evidence tab", () => {
  it("shows evaluations for the node and its descendants as a compact table", async () => {
    const inspector = await open("thing.webapp", "Evidence", (qc) =>
      qc.setQueryData(qk.evaluations(SYSTEM, undefined), {
        evaluations: [
          evaluation({ id: "e.child", subjectId: "screen.people", criterion: "C.webapp.screen.people" }),
          evaluation({ id: "e.other", subjectId: "system.keep-in-touch", criterion: "C.system.structure" }),
        ],
      }),
    );
    await waitFor(() => expect(within(inspector).getByRole("table")).toBeTruthy());
    expect(within(inspector).getAllByRole("row")).toHaveLength(2);
    expect(within(inspector).queryByText(/C\.system\.structure/)).toBeNull();
  });

  it("is honest when nothing has run", async () => {
    const inspector = await open("thing.webapp", "Evidence", undefined);
    expect(within(inspector).getByText("No evaluations yet — nothing is known")).toBeTruthy();
    expect(inspector.querySelector('[data-verdict="pass"]')).toBeNull();
  });
});
