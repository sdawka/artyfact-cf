import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Evaluation, Finding, SystemCommit } from "../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { buildIndex } from "@/model/index";
import { renderApp } from "@/testing/render";

const BASE = "/s/system.keep-in-touch/r/head";
const search = (router: { state: { location: { search: string } } }) => new URLSearchParams(router.state.location.search);
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key: k, ...init }));

describe("Shell", () => {
  it("renders Home at /", async () => {
    const { router } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Systems" })).toBeTruthy();
    const card = await screen.findByRole("link", { name: /Keep in Touch/ });
    expect(screen.queryByRole("navigation", { name: "Views" })).toBeNull();
    act(() => card.click());
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/overview`));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  });

  it("redirects /s/:systemId to its head overview", async () => {
    const { router } = renderApp("/s/system.keep-in-touch");
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/overview`));
  });

  it("renders Overview plus three groups (4, 4, 1) whose links keep focus, layer and candidates", async () => {
    renderApp(`${BASE}/overview?layer=phenome&focus=screen.people&candidates=c1&journey=J.contacts`);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const groups = within(nav).getAllByRole("group");
    expect(groups.map((g) => [g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent, within(g).getAllByRole("link").length])).toEqual([
      ["Genome", 4], ["Proteome", 4], ["Phenome", 1],
    ]);
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "◎Overview", "▦Map", "⇢Journeys", "△Theory", "{}Code", "⎇Work", "✓Evaluations", "↺Changelog", "⇄Compare", "◍Deployments",
    ]);
    expect(within(groups[2]!).getByRole("link", { name: /Deployments/ }).getAttribute("href")).toContain(`${BASE}/phenome`);
    for (const l of links) {
      const qs = new URLSearchParams(l.getAttribute("href")!.split("?")[1]);
      expect(qs.get("layer")).toBe("phenome");
      expect(qs.get("focus")).toBe("screen.people");
      expect(qs.get("candidates")).toBe("c1");
      expect(qs.get("journey")).toBeNull();
    }
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("aria-current")).toBe("page");
  });

  it("wordmark links to /", async () => {
    renderApp(`${BASE}/overview?focus=screen.people`);
    expect((await screen.findByRole("link", { name: "artyfact" })).getAttribute("href")).toBe("/");
  });

  it("g l opens the Changelog and g h (legacy) does too", async () => {
    const { router } = renderApp(`${BASE}/overview?focus=screen.people`);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
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

  it("routes Code, Compare and Deployments to views with their h1", async () => {
    for (const [view, name] of [["code", "Code"], ["compare", "Compare"], ["phenome", "Deployments"]] as const) {
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
    act(() => void fireEvent.keyDown(handle, { key: "ArrowLeft" }));
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(before + 16);
    act(() => void fireEvent.keyDown(handle, { key: "ArrowRight" }));
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
      qc.setQueryData(qk.model("system.keep-in-touch", "head"), b);
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
      qc.setQueryData(qk.evaluations("system.keep-in-touch"), { evaluations: [evaluation] });
      qc.setQueryData(qk.history("system.keep-in-touch"), { commits: history });
    };
    const screenPeopleVerdict = async () => {
      const inspector = await screen.findByRole("complementary", { name: "Inspector" });
      act(() => within(inspector).getByRole("tab", { name: "Rules & claims" }).click());
      const chip = inspector.querySelector('[title="Criterion: C.webapp.screen.people"]')!;
      return chip.closest("section")!.querySelector("[data-verdict]")!.getAttribute("data-verdict");
    };
    it("marks the TopBar only when a loaded evaluation came from the fake provider", async () => {
      renderApp(`${BASE}/overview`, undefined, seed);
      await screen.findByRole("heading", { level: 1, name: "Overview" });
      expect(screen.queryByText("System One: fake provider")).toBeNull();
    });
    it("shows the fake-provider marker in the TopBar", async () => {
      renderApp(`${BASE}/overview`, undefined, (qc) => {
        seed(qc);
        qc.setQueryData(qk.evaluations("system.keep-in-touch"), { evaluations: [{ ...evaluation, provenance: { provider: "fake" } }] });
      });
      const pill = await screen.findByText("System One: fake provider");
      expect(pill.closest("header")).toBeTruthy();
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
