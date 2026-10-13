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
    expect(screen.getByRole("link", { name: "System overview" }).getAttribute("href")).toBe(`${BASE}/overview`);
  });

  it("rejects missing Things in a deep view instead of showing an unrelated System view", async () => {
    renderApp(`${BASE}/things/thing.missing/phenome`);
    expect(await screen.findByText("This Thing is not in the selected System revision.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Deployments" })).toBeNull();
  });
});
