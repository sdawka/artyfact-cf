import "@/views/map/testing/flowEnv";
import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Evaluation, Finding, SystemCommit } from "../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { buildIndex } from "@/model/index";
import { renderApp } from "@/testing/render";

const BASE = "/s/system.peopling/r/head";
const search = (router: { state: { location: { search: string } } }) => new URLSearchParams(router.state.location.search);
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key: k, ...init }));

describe("Shell", () => {
  it.each([
    ["/", "Go to a System or Part"],
    ["/parts/part.ui.buttons/2.1.0", "Go to a System or Part"],
    [`${BASE}/overview`, "Go to node"],
  ])("palette shortcuts defer to other overlays and toggle normally at %s", async (path, title) => {
    renderApp(path);
    const admin = await screen.findByRole("button", { name: "Admin token" });
    await act(() => admin.click());
    const input = await screen.findByLabelText("Token for admin actions");
    await waitFor(() => expect(document.activeElement).toBe(input));
    const blocked = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    await act(() => { input.dispatchEvent(blocked); });
    expect(blocked.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    expect(document.activeElement).toBe(input);
    await act(() => void fireEvent.keyDown(input, { key: "Escape" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Admin token" })).toBeNull());
    const consumed = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    consumed.preventDefault();
    await act(() => { window.dispatchEvent(consumed); });
    expect(screen.queryByRole("dialog", { name: title })).toBeNull();
    key("k", { metaKey: true });
    const palette = await screen.findByRole("dialog", { name: title });
    await act(() => void fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "k", ctrlKey: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
  });

  it("restores the Home palette trigger after Escape", async () => {
    renderApp("/");
    const trigger = await screen.findByRole("button", { name: "Go to…" });
    trigger.focus();
    await act(() => trigger.click());
    const dialog = await screen.findByRole("dialog", { name: "Go to a System or Part" });
    await act(() => void fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Go to a System or Part" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("moves focus from mobile More to the token input and restores More on close", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      renderApp("/");
      const more = await screen.findByRole("button", { name: "More" });
      more.focus();
      await act(() => void fireEvent.keyDown(more, { key: "ArrowDown" }));
      const admin = await screen.findByRole("menuitem", { name: "Admin token" });
      await act(() => admin.click());
      const input = await screen.findByLabelText("Token for admin actions");
      await waitFor(() => expect(document.activeElement).toBe(input));
      await act(() => void fireEvent.keyDown(input, { key: "Escape" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Admin token" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(more));
    } finally {
      cleanup();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("opens full labelled mobile navigation and closes only that overlay on Escape", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      const { router } = renderApp(`${BASE}/map?focus=screen.people&layer=proteome`);
      const menu = await screen.findByRole("button", { name: "Menu" });
      await act(() => menu.click());
      const drawer = await screen.findByRole("dialog", { name: "Navigation" });
      expect(within(drawer).getByRole("link", { name: /Journeys/ }).textContent).toContain("Journeys");
      await act(() => void fireEvent.keyDown(within(drawer).getByRole("link", { name: /Map/ }), { key: "Escape" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
      expect(search(router).get("focus")).toBe("screen.people");
      expect(document.activeElement).toBe(menu);
      await act(() => menu.click());
      await act(() => within(screen.getByRole("dialog", { name: "Navigation" })).getByRole("link", { name: /Map/ }).click());
      await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/map`));
      expect(search(router).get("layer")).toBe("proteome");
      expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
      await act(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
        fireEvent(window, new Event("resize"));
      });
      expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
      expect(screen.getByRole("navigation", { name: "Views" })).toBeTruthy();
    } finally {
      cleanup();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("renders Home at /", async () => {
    const { router } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Systems" })).toBeTruthy();
    const card = await screen.findByRole("link", { name: /^Peopling$/ });
    expect(screen.queryByRole("navigation", { name: "Views" })).toBeNull();
    act(() => card.click());
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/map`));
    expect(await screen.findByRole("heading", { level: 1, name: "Map" })).toBeTruthy();
  });

  it("opens the environment when entering a System with one Thing", async () => {
    const { router } = renderApp("/s/system.peopling");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/map`));
    expect(search(router).get("scope")).toBe("environment");
  });

  it("renders Map above three layer groups (3, 4, 1) whose links keep focus, layer and candidates", async () => {
    renderApp(`${BASE}/overview?layer=phenome&focus=screen.people&candidates=c1&journey=J.contacts`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const groups = within(nav).getAllByRole("group");
    expect(groups.map((g) => [g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent, within(g).getAllByRole("link").length])).toEqual([
      ["Genome", 3], ["Proteome", 4], ["Phenome", 1],
    ]);
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Map", "Overview", "Journeys", "Theory", "Code", "Work", "Review", "Evaluations", "Changelog", "Deployments", "Private Parts",
    ]);
    expect(within(groups[2]!).getByRole("link", { name: /Deployments/ }).getAttribute("href")).toContain(`${BASE}/phenome`);
    expect(within(nav).getByRole("link", { name: "Private Parts" }).getAttribute("href")).toBe(`${BASE}/parts`);
    for (const l of links.filter((link) => link.getAttribute("title") !== "Private Parts")) {
      const qs = new URLSearchParams(l.getAttribute("href")!.split("?")[1]);
      expect(qs.get("layer")).toBe("phenome");
      expect(qs.get("focus")).toBe("screen.people");
      expect(qs.get("candidates")).toBe("c1");
      expect(qs.get("journey")).toBeNull();
    }
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("aria-current")).toBe("page");
  });

  it("each layer group carries its question as a quiet subline, separate from the group label", async () => {
    renderApp(`${BASE}/overview`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const groups = within(nav).getAllByRole("group");
    const read = (attr: string) => groups.map((g) => document.getElementById(g.getAttribute(attr)!)?.textContent);
    expect(read("aria-labelledby")).toEqual(["Genome", "Proteome", "Phenome"]);
    expect(read("aria-describedby")).toEqual(["What should it be", "What is being made", "What does it do"]);
    expect(within(nav).queryByRole("link", { name: /Compare/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /Thing workspace/ })).toBeNull();
  });

  it("hides the Review count at zero", async () => {
    renderApp(`${BASE}/overview`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("link", { name: "Review" }).textContent).toBe("Review");
  });

  it("keeps the rail inside a Thing workspace and resolves Review there", async () => {
    const { router } = renderApp(`${BASE}/things/thing.webapp/work`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    expect(within(nav).queryByRole("link", { name: /Thing workspace/ })).toBeNull();
    act(() => within(nav).getByRole("link", { name: "Review" }).click());
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/things/thing.webapp/review`));
    expect(await screen.findByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
    // Review lists the whole System's decisions, and inside a Thing it says so.
    expect(screen.getByText("Review shows decisions for the whole System.")).toBeTruthy();
  });

  it("g r opens Review keeping params", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    key("g");
    key("r");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/review`));
    expect(await screen.findByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
    expect(search(router).get("focus")).toBe("screen.people");
    expect(screen.getByText("Nothing is waiting on you.")).toBeTruthy();
  });

  it("/work?panel=promote redirects to /review keeping the other params and the hash", async () => {
    const { router } = renderApp(`${BASE}/work?panel=promote&evolution=e1#gates`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/review`));
    expect(search(router).get("panel")).toBe("promote");
    expect(search(router).get("evolution")).toBe("e1");
    expect(router.state.location.hash).toBe("#gates");
  });

  it("/things/:thingId/work?panel=promote redirects to that Thing's Review keeping the other params", async () => {
    const { router } = renderApp(`${BASE}/things/thing.webapp/work?panel=promote&evolution=e1&focus=screen.people`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/things/thing.webapp/review`));
    expect(search(router).get("panel")).toBe("promote");
    expect(search(router).get("evolution")).toBe("e1");
    expect(search(router).get("focus")).toBe("screen.people");
  });

  it("/work with another panel stays on Work", async () => {
    const { router } = renderApp(`${BASE}/work?panel=intent`);
    expect(await screen.findByRole("heading", { level: 1, name: "Work" })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`${BASE}/work`);
  });

  it("wordmark links to /", async () => {
    renderApp(`${BASE}/overview?focus=screen.people`);
    expect((await screen.findByRole("link", { name: "artyfact" })).getAttribute("href")).toBe("/");
  });

  it("g l opens the Changelog and g h (legacy) does too", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    key("g");
    key("l");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/changelog`));
    expect(await screen.findByRole("heading", { level: 1, name: "Changelog" })).toBeTruthy();
    expect(search(router).get("focus")).toBe("screen.people");
    key("g");
    key("d");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/phenome`));
    key("g");
    key("h");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/changelog`));
  });

  it("/history redirects to /changelog keeping ?commit= and the hash", async () => {
    const { router } = renderApp(`${BASE}/history?commit=sc-3&evolution=evolution.2#criteria`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/changelog`));
    expect(router.state.location.hash).toBe("#criteria");
    expect(search(router).get("commit")).toBe("sc-3");
    expect(search(router).get("evolution")).toBe("evolution.2");
  });

  it("routes Code, Review, Compare and Deployments to views with their h1", async () => {
    for (const [view, name] of [["code", "Code"], ["review", "Review"], ["compare", "Compare"], ["phenome", "Deployments"]] as const) {
      renderApp(`${BASE}/${view}`);
      expect(await screen.findByRole("heading", { level: 1, name })).toBeTruthy();
      cleanup();
    }
  });

  it("unknown paths offer a way Home", async () => {
    renderApp("/nope");
    expect((await screen.findByRole("link", { name: "Open Home" })).getAttribute("href")).toBe("/");
  });

  it("shows the fixture pill, phase and canonical state", async () => {
    renderApp(`${BASE}/overview`);
    expect(await screen.findByText("fixture data")).toBeTruthy();
    expect(screen.getByText("Phase: unrealized")).toBeTruthy();
    expect(screen.getByText("canonical")).toBeTruthy();
  });

  it("LayerSwitch sits in the Map header (not the TopBar) and writes ?layer=", async () => {
    const { router } = renderApp(`${BASE}/map`);
    const topBar = (await screen.findByRole("link", { name: "artyfact" })).closest("header")!;
    expect(within(topBar).queryByRole("tablist", { name: "Layer" })).toBeNull();
    const tabs = await screen.findByRole("tablist", { name: "Layer" });
    const tab = (name: string) => within(tabs).getByRole("tab", { name });
    expect(tab("Genome").getAttribute("aria-selected")).toBe("true");
    await act(async () => tab("Proteome").click());
    await waitFor(() => {
      expect(search(router).get("layer")).toBe("proteome");
      expect(tab("Proteome").getAttribute("aria-selected")).toBe("true");
    });
    await act(async () => void fireEvent.keyDown(tab("Proteome"), { key: "ArrowRight" }));
    await waitFor(() => {
      expect(search(router).get("layer")).toBe("phenome");
      expect(tab("Phenome").getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tab("Phenome"));
    });
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

  it("Escape closes Map Details before clearing the selected tile", async () => {
    const { router } = renderApp(`${BASE}/map?scope=thing.webapp&focus=screen.people&inspect=1`);
    await screen.findByRole("complementary", { name: "Inspector" });
    key("Escape");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull());
    expect(search(router).get("focus")).toBe("screen.people");
    expect(search(router).get("scope")).toBe("thing.webapp");
    expect(search(router).has("inspect")).toBe(false);
    expect(router.state.historyAction).toBe("REPLACE");
    key("Escape");
    expect(search(router).get("focus")).toBeNull();
    expect(search(router).get("scope")).toBe("thing.webapp");
  });

  it("leaves Map Details intact when Escape comes from a text field or the command palette", async () => {
    const { router } = renderApp(`${BASE}/map?scope=thing.webapp&focus=screen.people&inspect=1`);
    await screen.findByRole("complementary", { name: "Inspector" });
    await act(() => screen.getByRole("button", { name: /^Admin token$/ }).click());
    const token = screen.getByLabelText("Token for admin actions");
    await act(() => void fireEvent.keyDown(token, { key: "Escape" }));
    expect(search(router).get("inspect")).toBe("1");
    expect(search(router).get("focus")).toBe("screen.people");
    expect(screen.queryByRole("dialog", { name: "Admin token" })).toBeNull();
    key("k", { metaKey: true });
    const palette = await screen.findByRole("dialog");
    await act(() => void fireEvent.keyDown(within(palette).getByRole("combobox"), { key: "Escape" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(search(router).get("inspect")).toBe("1");
    expect(search(router).get("focus")).toBe("screen.people");
    expect(search(router).get("scope")).toBe("thing.webapp");
  });

  it("does not render the Inspector without focus", async () => {
    renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
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
    const sibs = buildIndex(fixtureBundle()).siblings("screen.people").map((e) => e.id);
    const i = sibs.indexOf("screen.people");
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("complementary", { name: "Inspector" });
    key("]");
    await waitFor(() => expect(search(router).get("focus")).toBe(sibs[i + 1]));
    key("[");
    await waitFor(() => expect(search(router).get("focus")).toBe("screen.people"));
    key("[");
    await waitFor(() => expect(search(router).get("focus")).toBe(sibs[i - 1]));
  });

  it("g m goes to the Map keeping params", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    key("g");
    key("m");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/map`));
    expect(search(router).get("focus")).toBe("screen.people");
  });

  it("serves the existing style page at /style", async () => {
    renderApp("/style");
    expect(await screen.findByRole("heading", { level: 1, name: "Style sheet" })).toBeTruthy();
  });

  it("moves focus to the Inspector title on open and restores it on Esc", async () => {
    const { router } = renderApp(`${BASE}/overview`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const mapLink = within(nav).getByRole("link", { name: /Map/ });
    mapLink.focus();
    await act(() => router.navigate(`${BASE}/overview?focus=screen.people`));
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    await waitFor(() => expect(document.activeElement).toBe(within(inspector).getByRole("heading", { level: 2 })));
    key("Escape");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull());
    expect(document.activeElement).toBe(mapLink);
  });

  it("resizes the Inspector with the arrow keys on its handle", async () => {
    renderApp(`${BASE}/overview?focus=screen.people`);
    const handle = await screen.findByRole("separator", { name: "Resize Inspector" });
    const before = Number(handle.getAttribute("aria-valuenow"));
    act(() => void fireEvent.keyDown(handle, { key: "ArrowRight" }));
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(before - 16);
    act(() => void fireEvent.keyDown(handle, { key: "ArrowLeft" }));
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(before);
  });

  it("opens rule findings about journey steps (`<journey>/<step>`) in the Inspector", async () => {
    const finding: Finding = {
      level: "warning", rule: "journeys.unresolved", subject: "J.connect/s4", message: "Step s4 is unresolved",
      facts: [], derivation: { relation: "warning", tuple: [], edb: false, children: [] } as unknown as Finding["derivation"],
    };
    renderApp(`${BASE}/overview?focus=${encodeURIComponent("J.connect/s4")}`, undefined, (qc) => {
      const b = fixtureBundle();
      b.readiness.modelReadiness.findings.push(finding);
      qc.setQueryData(qk.model("system.peopling", "head"), b);
    });
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getAllByText("J.connect/s4").length).toBeGreaterThan(0);
    act(() => within(inspector).getByRole("tab", { name: "Rules & claims" }).click());
    expect(within(inspector).getByText(/Step s4 is unresolved/)).toBeTruthy();
  });

  describe("verdict scope in the Inspector", () => {
    const evaluation: Evaluation = {
      id: "ev.1", candidate: "cand.unpromoted", hook: "hook.webapp.screen.people", criterion: "C.webapp.screen.people",
      ownerId: "thing.webapp", subjectId: "screen.people", targetRef: "artifact.webapp@abc", execution: "completed",
      verdict: "pass", verifier: "v", startedAt: "2026-10-01T00:00:00Z", observations: [], limitations: [], provenance: {},
    };
    const history: SystemCommit[] = [{
      id: "sc.1", parent: null, genomeCommit: "g", manifest: [], evolutions: [], candidates: ["cand.old"], rejected: [],
      evidence: [], decision: { by: "admin", policy: "p", rationale: "r", at: "2026-10-01T00:00:00Z" },
    }];
    const seed = (qc: QueryClient) => {
      qc.setQueryData(qk.evaluations("system.peopling"), { evaluations: [evaluation] });
      qc.setQueryData(qk.history("system.peopling"), { commits: history });
    };
    const screenPeopleVerdict = async () => {
      const inspector = await screen.findByRole("complementary", { name: "Inspector" });
      act(() => within(inspector).getByRole("tab", { name: "Rules & claims" }).click());
      const chip = inspector.querySelector('[title="Criterion: C.webapp.screen.people"]')!;
      return chip.closest("section")!.querySelector("[data-verdict]")!.getAttribute("data-verdict");
    };
    it("marks the TopBar only when a loaded evaluation came from the fake provider", async () => {
      renderApp(`${BASE}/overview`, undefined, seed);
      await screen.findByRole("heading", { level: 1, name: "Peopling" });
      expect(screen.queryByText("System One: fake provider")).toBeNull();
    });
    it("shows the fake-provider marker in the TopBar", async () => {
      renderApp(`${BASE}/overview`, undefined, (qc) => {
        seed(qc);
        qc.setQueryData(qk.evaluations("system.peopling"), { evaluations: [{ ...evaluation, provenance: { provider: "fake" } }] });
      });
      const pill = await screen.findByText("System One: fake provider");
      expect(pill.closest("header")).toBeTruthy();
    });
    it("on the hosted demo shows its notice instead of the fake-provider marker", async () => {
      const notice = "Hosted demo: judgments are simulated. Run it locally on your Cloudflare account for Clef or Jev.";
      renderApp(`${BASE}/overview`, undefined, (qc) => {
        seed(qc);
        qc.setQueryData(qk.platform(), { hostedDemo: true, notice });
        qc.setQueryData(qk.evaluations("system.peopling"), { evaluations: [{ ...evaluation, provenance: { provider: "simulated" } }] });
      });
      const pill = await screen.findByText("Hosted demo: judgments are simulated");
      expect(pill.getAttribute("title")).toBe(notice);
      expect(screen.queryByText("System One: fake provider")).toBeNull();
    });
    it("never shows an unpromoted candidate's pass on the canonical view", async () => {
      renderApp(`${BASE}/overview?focus=screen.people`, undefined, seed);
      expect(await screenPeopleVerdict()).toBe("not-run");
    });
    it("shows it when that candidate is selected", async () => {
      renderApp(`${BASE}/overview?focus=screen.people&candidates=cand.unpromoted`, undefined, seed);
      expect(await screenPeopleVerdict()).toBe("pass");
    });
  });
});
