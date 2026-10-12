import { act, configure, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const base = "/s/system.keep-in-touch/r/head/journeys";
const search = (r: { router: { state: { location: { search: string } } } }) => new URLSearchParams(r.router.state.location.search);

// The view chunk, elk and React Flow load lazily; give them room when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

describe("Journeys view", () => {
  it("lists every journey and defaults to the first non-deferred one", async () => {
    renderApp(base);
    const catalog = await screen.findByRole("navigation", { name: "Journeys" });
    expect(catalog.querySelectorAll("li")).toHaveLength(10);
    expect(within(catalog).getAllByText("deferred")).toHaveLength(1);
    const current = catalog.querySelectorAll("[aria-current='true']");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Connect with someone through a consented invitation");
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
    expect(search(r).get("journey")).toBe("J.contact");
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

  it("offers zoom, zoom out and fit controls", async () => {
    renderApp(`${base}?journey=J.connect`);
    const canvas = await screen.findByTestId("journey-canvas");
    for (const name of [/zoom in/i, /zoom out/i, /fit view/i]) expect(await within(canvas).findByRole("button", { name })).toBeTruthy();
  });

  describe("with segments and a provisional step", () => {
    const seed = (qc: import("@tanstack/react-query").QueryClient) => {
      const bundle = fixtureBundle();
      const j = bundle.model.journeys.find((x) => x.id === "J.connect")!;
      j.segments = [
        { name: "Invite", steps: ["s1", "s2", "s3"] },
        { name: "Accept", steps: ["s4", "s5", "s6", "s7"] },
      ];
      j.steps.find((x) => x.id === "s1")!.unresolved = true;
      qc.setQueryData(qk.model("system.keep-in-touch", "head"), bundle);
    };

    it("a segment tab filters the visible steps", async () => {
      renderApp(`${base}?journey=J.connect`, undefined, seed);
      const canvas = await screen.findByTestId("journey-canvas");
      await waitFor(() => expect(within(canvas).getAllByLabelText(/^Step /)).toHaveLength(14));
      act(() => screen.getByRole("tab", { name: "Invite" }).click());
      await waitFor(() => expect(within(canvas).getAllByLabelText(/^Step /)).toHaveLength(3));
      expect(screen.getByRole("tab", { name: "Invite" }).getAttribute("aria-selected")).toBe("true");
    });

    it("falls back to all steps when the journey changes", async () => {
      const r = renderApp(`${base}?journey=J.connect`, undefined, seed);
      const canvas = await screen.findByTestId("journey-canvas");
      await waitFor(() => expect(within(canvas).getAllByLabelText(/^Step /)).toHaveLength(14));
      act(() => screen.getByRole("tab", { name: "Accept" }).click());
      await waitFor(() => expect(within(canvas).getAllByLabelText(/^Step /)).toHaveLength(4));
      act(() => void r.router.navigate(`${base}?journey=J.contact`));
      await waitFor(() => expect(screen.queryByRole("tab", { name: "Accept" })).toBeNull());
      await waitFor(() => expect(within(canvas).getAllByLabelText(/^Step /)).toHaveLength(7));
    });

    it("marks the provisional step with a question mark", async () => {
      renderApp(`${base}?journey=J.connect`, undefined, seed);
      const canvas = await screen.findByTestId("journey-canvas");
      const s1 = await within(canvas).findByLabelText(/^Step s1:/);
      expect(s1.hasAttribute("data-unresolved")).toBe(true);
      expect(s1.textContent).toContain("?");
    });
  });
});
