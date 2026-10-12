import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

const BASE = "/s/system.keep-in-touch/r/head";
const search = (router: { state: { location: { search: string } } }) => new URLSearchParams(router.state.location.search);
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key: k, ...init }));

describe("Shell", () => {
  it("redirects / to the Keep in Touch overview", async () => {
    const { router } = renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/overview`));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  });

  it("renders six nav links that preserve focus, layer and candidates", async () => {
    renderApp(`${BASE}/overview?layer=phenome&focus=screen.people&candidates=c1&journey=J.contacts`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["◎Overview", "▦Map", "△Theory", "⎇Work", "✓Evaluations", "↺History"]);
    for (const l of links) {
      const qs = new URLSearchParams(l.getAttribute("href")!.split("?")[1]);
      expect(qs.get("layer")).toBe("phenome");
      expect(qs.get("focus")).toBe("screen.people");
      expect(qs.get("candidates")).toBe("c1");
      expect(qs.get("journey")).toBeNull();
    }
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the fixture pill, phase and canonical state", async () => {
    renderApp(`${BASE}/overview`);
    expect(await screen.findByText("fixture data")).toBeTruthy();
    expect(screen.getByText("Phase: unrealized")).toBeTruthy();
    expect(screen.getByText("canonical")).toBeTruthy();
  });

  it("LayerSwitch writes ?layer=", async () => {
    const { router } = renderApp(`${BASE}/map`);
    const tabs = await screen.findByRole("tablist", { name: "Layer" });
    expect(within(tabs).getByRole("tab", { name: "Genome" }).getAttribute("aria-selected")).toBe("true");
    act(() => within(tabs).getByRole("tab", { name: "Proteome" }).click());
    await waitFor(() => expect(search(router).get("layer")).toBe("proteome"));
    expect(within(tabs).getByRole("tab", { name: "Proteome" }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens the Inspector iff focus is set, and Esc closes it", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people&layer=phenome`);
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getByRole("heading", { level: 2 }).textContent).toContain("People");
    expect(within(inspector).getAllByText("screen.people").length).toBeGreaterThan(0);
    expect(within(inspector).getByRole("tab", { name: "What" }).getAttribute("aria-selected")).toBe("true");
    expect(within(inspector).getByRole("button", { name: "Open in Map" })).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: "Open in Journeys" })).toBeTruthy();
    key("Escape");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull());
    expect(search(router).get("focus")).toBeNull();
    expect(search(router).get("layer")).toBe("phenome");
  });

  it("does not render the Inspector without focus", async () => {
    renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
  });

  it("focusing a chip opens the Inspector; Dependencies lists links grouped by relation", async () => {
    renderApp(`${BASE}/overview?focus=entity.ContactRecord`);
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    act(() => within(inspector).getByRole("tab", { name: "Dependencies" }).click());
    expect(within(inspector).getByText("storedIn →")).toBeTruthy();
    expect(within(inspector).getByText("← governs")).toBeTruthy();
    act(() => within(inspector).getByRole("button", { name: /contactsStore/ }).click());
    await waitFor(() => expect(within(inspector).getByRole("heading", { level: 2 }).textContent).toContain("contactsStore"));
  });

  it("[ and ] move focus between siblings", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("complementary", { name: "Inspector" });
    key("]");
    await waitFor(() => expect(search(router).get("focus")).toBe("screen.person"));
    key("[");
    await waitFor(() => expect(search(router).get("focus")).toBe("screen.people"));
    key("[");
    await waitFor(() => expect(search(router).get("focus")).toBe("screen.today"));
  });

  it("g m goes to the Map keeping params", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    key("g");
    key("m");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/map`));
    expect(search(router).get("focus")).toBe("screen.people");
  });

  it("serves the existing style page at /style", async () => {
    renderApp("/style");
    expect(await screen.findByRole("heading", { level: 1, name: "Style sheet" })).toBeTruthy();
  });
});
