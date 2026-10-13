import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { fixtureBundle } from "@/api/fixtures";
import { renderApp } from "@/testing/render";

const SID = "system.keep-in-touch";
const BASE = `/s/${SID}/r/head`;
const THING = `${BASE}/things/thing.webapp`;

describe("Thing workspace", () => {
  it("keeps direct links stable as a second Genome-only Thing is added and offers full scoped views", async () => {
    const { router } = renderApp(THING, undefined, (qc) => {
      const bundle = structuredClone(fixtureBundle());
      bundle.model.things.push({ ...bundle.model.things[0]!, id: "thing.notes", name: "Notes", description: "Genome-only", templateRef: null, sections: [], artifacts: [], parts: [] });
      qc.setQueryData(qk.model(SID, "head"), bundle);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Keep in Touch web app" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Thing views" });
    expect(within(nav).getByRole("link", { name: "Map" }).getAttribute("href")).toBe(`${THING}/map?focus=thing.webapp`);
    await act(() => within(nav).getByRole("link", { name: "Deployments" }).click());
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
