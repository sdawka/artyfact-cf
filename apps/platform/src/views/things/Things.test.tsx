import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { fixtureBundle } from "@/api/fixtures";
import { renderApp } from "@/testing/render";

const SID = "system.peopling";
const BASE = `/s/${SID}/r/head`;
const THING = `${BASE}/things/thing.webapp`;

describe("Thing workspace", () => {
  it("keeps direct links stable as a second Genome-only Thing is added and offers full scoped views", async () => {
    const { router } = renderApp(THING, undefined, (qc) => {
      const bundle = structuredClone(fixtureBundle());
      bundle.model.things.push({ ...bundle.model.things[0]!, id: "thing.notes", name: "Notes", description: "Genome-only", templateRef: null, sections: [], artifacts: [], parts: [] });
      qc.setQueryData(qk.model(SID, "head"), bundle);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Peopling web app" })).toBeTruthy();
    // The rail serves the Thing scope; the page carries no second "Thing views" nav.
    expect(screen.queryByRole("navigation", { name: "Thing views" })).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Views" });
    expect(within(rail).getByRole("link", { name: "Map" }).getAttribute("href")).toContain(`${THING}/map`);
    await act(() => within(rail).getByRole("link", { name: "Deployments" }).click());
    expect(await screen.findByRole("heading", { name: "Deployments", level: 1 })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`${THING}/phenome`);
    // The scope path names the System (a link back), the Thing and the view: no trailing "System overview" action.
    const scope = screen.getByRole("navigation", { name: "Scope" });
    expect(within(scope).getByRole("link", { name: "Peopling" }).getAttribute("href")).toBe(`${BASE}/overview`);
    expect(within(scope).getByRole("link", { name: "Peopling web app" }).getAttribute("href")).toBe(THING);
    expect(within(scope).getByText("Deployments").getAttribute("aria-current")).toBe("page");
  });

  it("rejects missing Things in a deep view instead of showing an unrelated System view", async () => {
    renderApp(`${BASE}/things/thing.missing/phenome`);
    expect(await screen.findByText("This Thing is not in head.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Deployments" })).toBeNull();
  });

  it("leads with the Thing, one primary anchored to it, a Thing switcher and the layer sections", async () => {
    renderApp(THING);
    expect(await screen.findByRole("heading", { level: 1, name: "Peopling web app" })).toBeTruthy();
    const primary = screen.getByRole("link", { name: "Describe a change" }).getAttribute("href")!;
    expect(primary).toContain("/things/thing.webapp/work?");
    expect(primary).toContain("panel=intent");
    expect(primary).toContain("anchor=thing.webapp");
    expect(screen.getAllByRole("link", { name: "Map" }).some((l) => l.getAttribute("href")?.includes("/things/thing.webapp/map?focus=thing.webapp"))).toBe(true);
    expect(screen.getByRole("combobox", { name: "Thing" })).toBeTruthy();
    for (const name of ["Genome", "Source", "Realized outputs", "Phenome evidence"]) expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    // Source artifacts are a table, not JSON.
    expect(within(screen.getByRole("table")).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.queryByText(/"artifact":/)).toBeNull();
    const related = screen.getByRole("navigation", { name: "Related views" });
    expect(within(related).getAllByRole("link").map((l) => l.textContent)).toEqual(["Work for Peopling web app", "Review for Peopling web app", "Code for Peopling web app", "Deployments for Peopling web app"]);
  });

  it("filters a Thing-scoped view to the Thing, with a Show all control that lifts it", async () => {
    renderApp(`${THING}/phenome`);
    const note = await screen.findByTestId("thing-scope-note");
    expect(note.textContent).toContain("Showing Peopling web app");
    await act(() => within(note).getByRole("button", { name: "Show all" }).click());
    expect(screen.getByTestId("thing-scope-note").textContent).toContain("Showing everything in this System");
    expect(screen.getByRole("button", { name: "Show only Peopling web app" })).toBeTruthy();
  });
});
