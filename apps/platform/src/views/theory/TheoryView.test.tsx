import { act, configure, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { afterEach } from "vitest";
import { rowLinks } from "./LogicModel";

const url = "/s/system.peopling/r/head/theory";
const banner = /Hypotheses, not a validated causal model/;

/** The Grid toggle exists from 1280px; the claim list is the default reading. */
function openGrid() {
  act(() => screen.getByRole("tab", { name: "Grid" }).click());
}

// The view chunk, elk and React Flow load lazily; give them room when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

describe("Theory view", () => {
  const width = window.innerWidth;
  afterEach(() => Object.defineProperty(window, "innerWidth", { value: width, configurable: true }));

  it("shows the hypotheses banner and one row per claim", async () => {
    const { container } = renderApp(url);
    expect(await screen.findByText(banner)).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll("[data-claim]")).toHaveLength(5));
    expect([...container.querySelectorAll("[data-claim]")].map((r) => r.getAttribute("data-claim"))).toEqual(["T1", "T2", "T3", "T4", "T5"]);
  });

  it("marks T5 as deferred and no other row", async () => {
    const { container } = renderApp(url);
    await screen.findByText(banner);
    const deferred = [...container.querySelectorAll("[data-claim][data-deferred]")].map((r) => r.getAttribute("data-claim"));
    expect(deferred).toEqual(["T5"]);
    expect(within(container.querySelector<HTMLElement>("[data-claim='T5']")!).getByText("deferred")).toBeTruthy();
  });

  it("draws one link per hand-off in every row of the Grid view", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    const { container } = renderApp(url);
    await screen.findByText(banner);
    expect(container.querySelectorAll("path[data-link]")).toHaveLength(0);
    openGrid();
    const expected = fixtureBundle().model.claims.reduce((n, c) => n + rowLinks(c).length, 0);
    expect(expected).toBe(20);
    await waitFor(() => expect(container.querySelectorAll("path[data-link]")).toHaveLength(expected));
  });

  it("offers the Grid toggle only on wide screens", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    renderApp(url);
    await screen.findByText(banner);
    expect(screen.queryByRole("tab", { name: "Grid" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Theory" })).toBeTruthy();
  });

  it("shows the purpose statement and its success criteria", async () => {
    renderApp(url);
    expect((await screen.findAllByText(/Help an individual keep in touch/)).length).toBeGreaterThan(0);
    expect(screen.getByText("Success criteria")).toBeTruthy();
  });

  it("lists theory.* and purpose.* findings with a chip to the subject", async () => {
    const seeded = fixtureBundle().readiness;
    const base = seeded.modelReadiness.findings[0]!;
    const finding = { ...base, rule: "theory.indicator", level: "missing" as const, subject: "T2", message: "Claim T2 has no baseline for its indicator." };
    const other = { ...base, rule: "hook.unbound", subject: "C.system.autonomy", message: "unrelated finding" };
    renderApp(url, undefined, (qc) =>
      qc.setQueryData(qk.readiness("system.peopling", "head"), { ...seeded, modelReadiness: { findings: [other, finding], blockers: [] } }),
    );
    const gaps = await screen.findByRole("region", { name: /Theory gaps/ });
    expect(within(gaps).getByText("theory.indicator")).toBeTruthy();
    expect(within(gaps).getByText("Claim T2 has no baseline for its indicator.")).toBeTruthy();
    expect(within(gaps).queryByText("unrelated finding")).toBeNull();
    expect(within(gaps).getByTitle("Claim: T2")).toBeTruthy();
  });

  it("says no gaps were reported as header status, with no empty gaps section", async () => {
    renderApp(url);
    expect(await screen.findByText("No theory gaps reported")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Theory gaps/ })).toBeNull();
    expect(screen.queryByText(/\(0\)/)).toBeNull();
  });

  it("clicking a claim chip opens its Inspector body with observations unknown", async () => {
    renderApp(url);
    await screen.findByText(banner);
    const chip = (await screen.findAllByTitle("Claim: T1"))[0]!;
    act(() => chip.click());
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    expect(await within(inspector).findByText("Private context and a chosen cadence reduce forgetting")).toBeTruthy();
    expect(within(inspector).getByText("none yet — unknown")).toBeTruthy();
    expect(within(inspector).getByText("Limitation")).toBeTruthy();
  });

  it("the purpose body lists criteria, non-goals and constraints", async () => {
    renderApp(`${url}?focus=P1`);
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    for (const label of ["Statement", "Intended change", "Success criteria", "Non-goals", "Constraints"]) {
      expect(await within(inspector).findByText(label)).toBeTruthy();
    }
  });
});
