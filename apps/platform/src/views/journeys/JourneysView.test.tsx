import { act, configure, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

const base = "/s/system.keep-in-touch/r/head/journeys";
const search = (r: { router: { state: { location: { search: string } } } }) => new URLSearchParams(r.router.state.location.search);

// The view chunk, elk and React Flow load lazily; give them room when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

describe("Journeys view", () => {
  it("lists every journey and defaults to the first non-deferred one", async () => {
    renderApp(base);
    const catalog = await screen.findByRole("navigation", { name: "Journeys" });
    expect(within(catalog).getAllByRole("button", { name: /\S/ }).filter((b) => b.hasAttribute("aria-current") || b.closest("li")).length).toBeGreaterThanOrEqual(10);
    expect(within(catalog).getByText("deferred")).toBeTruthy();
    const current = catalog.querySelector("[aria-current='true']")!;
    expect(current.textContent).toContain("Create a pair connection");
  });

  it("draws J.connect: 14 step buttons in three lanes", async () => {
    renderApp(`${base}?journey=J.connect`);
    const canvas = await screen.findByTestId("journey-canvas");
    // React Flow hides nodes until measured, which never happens in jsdom, so query by label.
    await waitFor(() => expect(within(canvas).getAllByLabelText(/^Step /)).toHaveLength(14));
    expect([...canvas.querySelectorAll("[data-lane]")].map((l) => l.getAttribute("data-lane"))).toEqual(["actor", "system", "external"]);
  });

  it("selecting a journey in the catalog updates ?journey=", async () => {
    const r = renderApp(base);
    const catalog = await screen.findByRole("navigation", { name: "Journeys" });
    const second = within(catalog).getAllByRole("button").find((b) => b.textContent?.includes("Reach out to one person"))!;
    act(() => second.click());
    await waitFor(() => expect(search(r).get("journey")).toMatch(/^J\./));
    expect(search(r).get("journey")).not.toBe("J.connect");
  });

  it("clicking a step sets ?step= and focuses J.connect/s4", async () => {
    const r = renderApp(`${base}?journey=J.connect`);
    const canvas = await screen.findByTestId("journey-canvas");
    const s4 = await within(canvas).findByLabelText(/^Step s4:/);
    act(() => s4.click());
    await waitFor(() => expect(search(r).get("focus")).toBe("J.connect/s4"));
    expect(search(r).get("step")).toBe("s4");
    expect(await screen.findByRole("complementary", { name: "Inspector" })).toBeTruthy();
    await waitFor(() => expect(s4.getAttribute("aria-pressed")).toBe("true"));
  });

  it("a ?step= deep link opens the Inspector on that step", async () => {
    const r = renderApp(`${base}?journey=J.connect&step=s5`);
    await waitFor(() => expect(search(r).get("focus")).toBe("J.connect/s5"));
  });

  it("the step body's screen chip focuses the screen in the Map", async () => {
    const r = renderApp(`${base}?journey=J.connect&step=s4`);
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    const chip = await within(inspector).findByTitle("Screen: screen.invitation");
    act(() => chip.click());
    await waitFor(() => expect(r.router.state.location.pathname).toMatch(/\/map$/));
    expect(search(r).get("focus")).toBe("screen.invitation");
  });
});
