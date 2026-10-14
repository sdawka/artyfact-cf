import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntentAcceptResponse, IntentDecisionsRequest, Proposal } from "../../../../shared/api";
import { ADMIN_TOKEN_KEY } from "@/api/adminToken";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { buildIndex } from "@/model/index";
import { renderApp } from "@/testing/render";
import { candidate, realization, SYSTEM } from "../testData";
import { cascade, planFromOps } from "./agreement";
import { withDependencies, withDependents } from "./lib";
import { SAMPLE_PROPOSAL } from "./sample";

const WORK = `/s/${SYSTEM}/r/head/work`;
const PROPOSAL: Proposal = {
  ...SAMPLE_PROPOSAL,
  id: "proposal.1",
  questions: [],
  provenance: { router: { provider: "typesafe", model: "jev", calls: 3 }, translator: { provider: "openrouter", model: "gpt" }, genomeCommit: "abcdef0123", fake: false },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call { url: string; method: string; body: unknown; auth: string | null }

/** An API-mode backend: `/api/systems` answers, intent routes go to `intents`, everything else is empty. */
function stubApi(intents: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const call: Call = { url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") };
    if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
    if (u.includes("/intents")) {
      calls.push(call);
      return intents(call);
    }
    if (u.includes("/model")) return json(200, fixtureBundle());
    if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
    if (u.endsWith("/realization-plans")) return json(200, { plans: [] });
    return json(404, { error: { code: "not-found", message: "no" } });
  }));
  return calls;
}

const api = (qc: QueryClient) => {
  qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });
  qc.setQueryData(qk.evolutions(SYSTEM), { evolutions: [], realizations: [] });
};

const ACCEPTED: IntentAcceptResponse = {
  evolution: { ...fixtureBundle().model.evolutions[0]!, id: "evolution.9", title: "Show birthdays" },
  realization: realization({ id: "real.9", evolution: "evolution.9" }),
  candidate: candidate({ id: "cand.9" }),
  commit: "c0ffee",
};

/** A platform that stores decisions: PUT …/decisions cascades them onto the proposal it answers with. */
function decidingApi(start: Proposal, accept: IntentAcceptResponse = ACCEPTED) {
  let current = start;
  return stubApi((c) => {
    if (c.url.endsWith("/accept")) return json(201, accept);
    if (c.url.endsWith("/decisions")) {
      for (const d of (c.body as IntentDecisionsRequest).decisions) current = { ...current, plan: cascade(current.plan, d.nodeId, d.decision) };
      return json(200, current);
    }
    return json(c.method === "GET" ? 200 : 201, current);
  });
}

const acceptBtn = () => screen.getByRole("button", { name: "Accept agreed" }) as HTMLButtonElement;
const treeitem = (name: RegExp) => screen.getByRole("treeitem", { name });
const decisions = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/decisions")).map((c) => (c.body as IntentDecisionsRequest).decisions);

async function describe_(text: string) {
  fireEvent.change(await screen.findByLabelText("What should change?"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Propose changes" }));
}

afterEach(() => sessionStorage.removeItem(ADMIN_TOKEN_KEY));

describe("Describe a change", () => {
  it("submits the message with the header token and renders the proposal", async () => {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, "tok");
    const calls = stubApi(() => json(201, PROPOSAL));
    const { router } = renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays on people");
    expect(await screen.findByRole("heading", { name: "Proposed changes" })).toBeTruthy();
    expect(calls[0]).toMatchObject({ method: "POST", body: { message: "Show birthdays on people" }, auth: "Bearer tok" });
    await waitFor(() => expect(router.state.location.search).toContain("proposal=proposal.1"));
    // Routed path with confidence, and the provider label.
    expect(screen.getByText("confidence 82%")).toBeTruthy();
    expect(screen.getByText("provider real")).toBeTruthy();
    // Per-node diff: the update shows the current description before the proposed one.
    expect(screen.getByText("Review op.1 delta").parentElement?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Review op.1 delta"));
    fireEvent.click(screen.getByText("Review op.2 delta"));
    const fields = screen.getByRole("table", { name: "op.1 fields" });
    expect(within(fields).getByText(/One AddContactDialog only while invoked/)).toBeTruthy();
    expect(within(fields).getByText(/the birthday when known/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "op.2 fields" })).getAllByText("none")).toHaveLength(2);
    expect(within(screen.getByRole("table", { name: "op.2 criteria" })).getByText("C.people.birthday")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Problems with op.3" })).getByText(/does not declare/)).toBeTruthy();
    // One primary action: the Work header button steps back while the panel is open.
    expect(document.querySelectorAll("main button[class*='primary']")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Accept agreed" })).toBeTruthy();
    // The agreement tree: Thing → section → screen → … → the added component, no checkboxes.
    expect(screen.getByRole("tree", { name: "Proposed changes" })).toBeTruthy();
    expect(treeitem(/^Peopling web app/).getAttribute("aria-level")).toBe("1");
    expect(treeitem(/^Birthday field/).getAttribute("aria-level")).toBe("5");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("a Thing-level Agree PUTs one decision, every node inherits it, and Accept agreed sends the agreed ops", async () => {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, "tok");
    const calls = decidingApi(PROPOSAL);
    const { router } = renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    await screen.findByRole("tree", { name: "Proposed changes" });
    expect(acceptBtn().disabled).toBe(true);
    expect(screen.getByText("Decide every change first: 3 undecided.")).toBeTruthy();
    expect(screen.getByText("0 of 3 changes agreed · 3 undecided")).toBeTruthy();
    // The Thing row counts its subtree.
    expect(within(treeitem(/^Peopling web app/)).getAllByText("1 add · 1 update · 1 link").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Agree Peopling web app" }));
    // Enabled once the decision is saved (the tree shows it at once).
    await waitFor(() => expect(acceptBtn().disabled).toBe(false));
    await waitFor(() => expect(decisions(calls)).toEqual([[{ nodeId: "thing.webapp", decision: "agree" }]]));
    expect(calls.find((c) => c.url.endsWith("/decisions"))).toMatchObject({ method: "PUT", auth: "Bearer tok" });
    expect(screen.getByText("3 of 3 changes agreed")).toBeTruthy();
    // Inherited from the Thing: "mixed", while the Thing's own Agree is pressed.
    expect(screen.getByRole("button", { name: "Agree Birthday field" }).getAttribute("aria-pressed")).toBe("mixed");
    expect(screen.getByRole("button", { name: "Agree Peopling web app" }).getAttribute("aria-pressed")).toBe("true");
    expect(treeitem(/^Birthday field/).dataset.decision).toBe("agree");

    fireEvent.click(acceptBtn());
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/accept"))?.body).toEqual({ opIds: ["op.1", "op.2", "op.3"] }));
    await waitFor(() => {
      const p = new URLSearchParams(router.state.location.search);
      expect([p.get("evolution"), p.get("realization"), p.get("panel"), p.get("proposal")]).toEqual(["evolution.9", "real.9", null, null]);
    });
  });

  it("rejecting a child node blocks the node whose op needs it, shows mixed on the parent, and leaves it out of accept", async () => {
    const ops = [...PROPOSAL.ops, { id: "op.4", op: "link" as const, node: "screen.people", link: { rel: "contains", to: "component.BirthdayField" }, dependsOn: ["op.2"] }];
    const withLink: Proposal = { ...PROPOSAL, ops, plan: planFromOps(ops, buildIndex(fixtureBundle())) };
    const calls = decidingApi(withLink);
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    fireEvent.click(await screen.findByRole("button", { name: "Agree Peopling web app" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject Birthday field" }));
    await waitFor(() => expect(decisions(calls)).toHaveLength(2));
    const people = treeitem(/^People,/);
    expect(people.getAttribute("aria-label")).toContain("needs Birthday field");
    expect(within(people).getAllByText("needs Birthday field").length).toBeGreaterThan(0);
    expect(treeitem(/^Peopling web app/).dataset.decision).toBe("mixed");
    expect(screen.getByText("2 of 4 changes agreed · 2 rejected · 1 blocked by what they need")).toBeTruthy();
    fireEvent.click(acceptBtn());
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/accept"))?.body).toEqual({ opIds: ["op.1"] }));
  });

  it("a refused decision rolls back", async () => {
    const calls = stubApi((c) => (c.url.endsWith("/decisions") ? json(409, { error: { code: "invalid-state", message: "not open" } }) : json(201, PROPOSAL)));
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    fireEvent.click(await screen.findByRole("button", { name: "Agree Peopling web app" }));
    await waitFor(() => expect(decisions(calls)).toHaveLength(1));
    await waitFor(() => expect(acceptBtn().disabled).toBe(true));
    expect(decisions(calls)).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toMatch(/not open/);
  });

  it("an accept that defers changes keeps the panel open with the status and continues with the deferred proposal", async () => {
    const calls = decidingApi(PROPOSAL, { ...ACCEPTED, deferred: { proposal: "proposal.2", nodeIds: ["component.BirthdayField"] } });
    const { router } = renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    fireEvent.click(await screen.findByRole("button", { name: "Agree Peopling web app" }));
    fireEvent.click(screen.getByRole("button", { name: "Defer Birthday field" }));
    expect(await screen.findByText("1 of 3 changes agreed · 2 deferred")).toBeTruthy();
    expect(within(treeitem(/^Birthday field/)).getAllByText("deferred").length).toBeGreaterThan(0);
    fireEvent.click(acceptBtn());
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/accept"))?.body).toEqual({ opIds: ["op.1"] }));
    expect(await screen.findByText("Accepted 1 change into Show birthdays and committed it to the Genome. 2 deferred changes wait in a new proposal.")).toBeTruthy();
    expect(new URLSearchParams(router.state.location.search).get("panel")).toBe("intent");
    fireEvent.click(screen.getByRole("button", { name: "Continue with deferred" }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("proposal")).toBe("proposal.2"));
    expect(screen.queryByText(/deferred changes wait/)).toBeNull();
  });

  it("keyboard: arrows move between rows, a / r / d decide, Backspace clears", async () => {
    const calls = decidingApi(PROPOSAL);
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    await screen.findByRole("tree", { name: "Proposed changes" });
    expect(screen.getByText(/open and close/)).toBeTruthy();
    const thing = treeitem(/^Peopling web app/);
    expect(thing.tabIndex).toBe(0);
    act(() => thing.focus());
    fireEvent.keyDown(thing, { key: "a" });
    fireEvent.keyDown(thing, { key: "ArrowDown" });
    const section = treeitem(/^UI,/);
    expect(document.activeElement).toBe(section);
    expect(section.tabIndex).toBe(0);
    fireEvent.keyDown(section, { key: "r" });
    fireEvent.keyDown(section, { key: "d" });
    fireEvent.keyDown(section, { key: "Backspace" });
    fireEvent.keyDown(section, { key: "End" });
    expect(document.activeElement).toBe(treeitem(/^Birthday field/));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(thing);
    // ← on an open node closes it; → opens it again.
    fireEvent.keyDown(thing, { key: "ArrowLeft" });
    expect(thing.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(thing, { key: "ArrowRight" });
    expect(thing.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(decisions(calls)).toEqual([
      [{ nodeId: "thing.webapp", decision: "agree" }],
      [{ nodeId: "section.ui", decision: "reject" }],
      [{ nodeId: "section.ui", decision: "defer" }],
      [{ nodeId: "section.ui", decision: null }],
    ]));
    // Never green: no decision or chip asks for the success tone.
    expect(document.querySelector('[data-tone="pass"]')).toBeNull();
  });

  it("a proposal without a stored plan gets one from the model and keeps decisions locally", async () => {
    const calls = stubApi((c) => (c.url.endsWith("/accept") ? json(201, ACCEPTED) : json(201, { ...PROPOSAL, plan: [] })));
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    fireEvent.click(await screen.findByRole("button", { name: "Agree Peopling web app" }));
    expect(acceptBtn().disabled).toBe(false);
    expect(decisions(calls)).toEqual([]);
    // Nothing stores a deferral here, so the tree offers no Defer (button or key) rather than drop the changes on accept.
    expect(screen.queryByRole("button", { name: /^Defer / })).toBeNull();
    fireEvent.keyDown(treeitem(/^Peopling web app/), { key: "d" });
    expect(screen.queryByText(/deferred/)).toBeNull();
    fireEvent.click(acceptBtn());
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/accept"))?.body).toEqual({ opIds: ["op.1", "op.2", "op.3"] }));
  });

  it("holds Accept agreed while a decision is being saved, and offers Defer on a stored plan", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let current = PROPOSAL;
    const calls = stubApi((c) => {
      if (c.url.endsWith("/decisions")) {
        for (const d of (c.body as IntentDecisionsRequest).decisions) current = { ...current, plan: cascade(current.plan, d.nodeId, d.decision) };
        const answer = current;
        return gate.then(() => json(200, answer)) as unknown as Response;
      }
      return json(c.method === "GET" ? 200 : 201, current);
    });
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    expect(await screen.findByRole("button", { name: "Defer Peopling web app" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agree Peopling web app" }));
    await waitFor(() => expect(decisions(calls)).toHaveLength(1));
    expect(screen.getByText("3 of 3 changes agreed")).toBeTruthy();
    expect(acceptBtn().disabled).toBe(true);
    expect(screen.getByText("Saving decisions…")).toBeTruthy();
    release();
    await waitFor(() => expect(acceptBtn().disabled).toBe(false));
  });

  it("sends decision PUTs one at a time and holds accept until every queued save has answered", async () => {
    const gates: (() => void)[] = [];
    let current = PROPOSAL;
    const calls = stubApi((c) => {
      if (c.url.endsWith("/decisions")) {
        for (const d of (c.body as IntentDecisionsRequest).decisions) current = { ...current, plan: cascade(current.plan, d.nodeId, d.decision) };
        const answer = current;
        return new Promise<Response>((r) => gates.push(() => r(json(200, answer)))) as unknown as Response;
      }
      return json(c.method === "GET" ? 200 : 201, current);
    });
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    fireEvent.click(await screen.findByRole("button", { name: "Agree Peopling web app" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject Birthday field" }));
    await waitFor(() => expect(decisions(calls)).toHaveLength(1));
    // The second waits in the System's scope until the first answers.
    await new Promise((r) => setTimeout(r, 20));
    expect(decisions(calls)).toEqual([[{ nodeId: "thing.webapp", decision: "agree" }]]);
    expect(acceptBtn().disabled).toBe(true);
    gates[0]!();
    await waitFor(() => expect(decisions(calls)).toHaveLength(2));
    expect(decisions(calls)[1]).toEqual([{ nodeId: "component.BirthdayField", decision: "reject" }]);
    // The first answered, the second has not: still saving.
    expect(acceptBtn().disabled).toBe(true);
    expect(screen.getByText("Saving decisions…")).toBeTruthy();
    gates[1]!();
    await waitFor(() => expect(acceptBtn().disabled).toBe(false));
  });

  it("names why a node with errors cannot be agreed, in text the Agree button points at", async () => {
    const failing: Proposal = { ...PROPOSAL, problems: [{ opId: "op.3", severity: "error", message: "Unknown relation." }] };
    stubApi((c) => json(c.method === "GET" ? 200 : 201, failing));
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    const agree = (await screen.findByRole("button", { name: "Agree Peopling web app" })) as HTMLButtonElement;
    expect(agree.disabled).toBe(true);
    const described = document.getElementById(agree.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe("has errors, cannot be agreed");
  });

  it("answers a question inline and shows the revised proposal", async () => {
    const asking: Proposal = { ...PROPOSAL, ops: [], problems: [], questions: [{ id: "q.1", text: "Which screen should show birthdays?" }] };
    const calls = stubApi((c) => (c.url.endsWith("/reply") ? json(200, PROPOSAL) : json(201, asking)));
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Birthdays");
    const box = await screen.findByLabelText("Which screen should show birthdays?");
    expect(screen.queryByRole("button", { name: "Accept agreed" })).toBeNull();
    fireEvent.change(box, { target: { value: "People" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByRole("heading", { name: "Proposed changes" })).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith("/reply"))?.body).toEqual({ answer: "People", questionId: "q.1" });
    expect(screen.queryByLabelText("Which screen should show birthdays?")).toBeNull();
  });

  it("says intents are not available yet on a 501", async () => {
    stubApi(() => json(501, { error: { code: "not-implemented", message: "describing a change is not implemented yet" } }));
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Birthdays");
    expect((await screen.findByRole("alert")).textContent).toMatch(/intents not available yet/i);
  });

  it("an anchored entry shows the anchor and sends it", async () => {
    const calls = stubApi(() => json(201, PROPOSAL));
    const { router } = renderApp(`${WORK}?panel=intent&anchor=screen.people`, undefined, api);
    expect(await screen.findByText("Starting from")).toBeTruthy();
    expect(screen.getByText("screen.people")).toBeTruthy();
    await describe_("Add birthdays here");
    await screen.findByRole("heading", { name: "Proposed changes" });
    expect(calls[0]!.body).toEqual({ message: "Add birthdays here", anchor: "screen.people" });
    expect(new URLSearchParams(router.state.location.search).get("anchor")).toBe("screen.people");
  });

  it("the Inspector's Describe a change opens the panel anchored on the node", async () => {
    const { router } = renderApp(`/s/${SYSTEM}/r/head/map?focus=screen.people`);
    const link = await screen.findByRole("link", { name: "Describe a change" });
    act(() => link.click());
    await waitFor(() => expect(router.state.location.pathname).toBe(WORK));
    const p = new URLSearchParams(router.state.location.search);
    expect([p.get("panel"), p.get("anchor")]).toEqual(["intent", "screen.people"]);
    expect(await screen.findByText("Starting from")).toBeTruthy();
  });

  it("on fixture data: the form is disabled with the standard reason and the sample shows read-only", async () => {
    renderApp(`${WORK}?panel=intent`);
    expect(await screen.findByText("Sample proposal (fixture data, read-only)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Propose changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Describing a change needs the platform API. The UI is showing fixture data.").length).toBeGreaterThan(0);
    expect(acceptBtn().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("provider fake")).toBeTruthy();
    // Read-only tree: every decision is disabled, but the rows stay navigable.
    for (const b of within(screen.getByRole("tree")).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    const thing = treeitem(/^Peopling web app/);
    act(() => thing.focus());
    fireEvent.keyDown(thing, { key: "a" });
    expect(thing.dataset.decision).toBe("undecided");
    fireEvent.keyDown(thing, { key: "ArrowDown" });
    expect(document.activeElement).toBe(treeitem(/^UI,/));
  });

  it("the Work header opens and closes the panel", async () => {
    const { router } = renderApp(WORK);
    fireEvent.click(await screen.findByRole("button", { name: "Describe a change" }));
    await waitFor(() => expect(router.state.location.search).toContain("panel=intent"));
    expect(await screen.findByRole("heading", { level: 2, name: "Describe a change" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("panel="));
  });

  it("keeps ?evolution= across the round trip and the Work header actions stay", async () => {
    const { router } = renderApp(`${WORK}?evolution=evolution.1`);
    fireEvent.click(await screen.findByRole("button", { name: "Describe a change" }));
    await waitFor(() => expect(router.state.location.search).toContain("panel=intent"));
    expect(router.state.location.search).toContain("evolution=evolution.1");
    expect(screen.getByRole("button", { name: "+ Evolution" })).toBeTruthy();
    const heading = await screen.findByRole("heading", { level: 2, name: "Describe a change" });
    expect(document.activeElement).toBe(heading);
    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("panel="));
    expect(router.state.location.search).toContain("evolution=evolution.1");
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "Describe a change" })[0]);
  });

  it("replaces the board and detail while open and keeps the board after Back to board", async () => {
    const { router } = renderApp(`${WORK}?panel=intent&anchor=screen.people`);
    expect(await screen.findByRole("heading", { level: 2, name: "Describe a change" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Evolution board" })).toBeNull();
    expect(screen.queryByText(/Select an Evolution to see/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(await screen.findByText(/Select an Evolution to see|No Evolutions yet/)).toBeTruthy();
  });
});

describe("op dependencies", () => {
  const ops = SAMPLE_PROPOSAL.ops;
  it("closes over dependents and dependencies", () => {
    expect([...withDependents(ops, ["op.2"])].sort()).toEqual(["op.2", "op.3"]);
    expect([...withDependencies(ops, ["op.3"])].sort()).toEqual(["op.2", "op.3"]);
    expect([...withDependents(ops, ["op.1"])]).toEqual(["op.1"]);
  });
});
