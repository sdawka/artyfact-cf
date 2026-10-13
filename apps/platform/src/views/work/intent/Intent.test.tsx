import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntentAcceptResponse, Proposal } from "../../../../shared/api";
import { ADMIN_TOKEN_KEY } from "@/api/adminToken";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { candidate, realization, SYSTEM } from "../testData";
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
    return json(404, { error: { code: "not-found", message: "no" } });
  }));
  return calls;
}

const api = (qc: QueryClient) => {
  qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });
  qc.setQueryData(qk.evolutions(SYSTEM), { evolutions: [], realizations: [] });
};

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
    const fields = screen.getByRole("table", { name: "op.1 fields" });
    expect(within(fields).getByText(/One AddContactDialog only while invoked/)).toBeTruthy();
    expect(within(fields).getByText(/the birthday when known/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "op.2 fields" })).getAllByText("none")).toHaveLength(2);
    expect(within(screen.getByRole("table", { name: "op.2 criteria" })).getByText("C.people.birthday")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Problems with op.3" })).getByText(/does not declare/)).toBeTruthy();
    // One primary action: the Work header button steps back while the panel is open.
    expect(document.querySelectorAll("main button[class*='primary']")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Accept selected" })).toBeTruthy();
  });

  it("toggling an op off excludes it (and its dependents) from the accept body, then opens the candidate", async () => {
    const accepted: IntentAcceptResponse = {
      evolution: { ...fixtureBundle().model.evolutions[0]!, id: "evolution.9" },
      realization: realization({ id: "real.9", evolution: "evolution.9" }),
      candidate: candidate({ id: "cand.9" }),
      commit: "c0ffee",
    };
    const calls = stubApi((c) => (c.url.endsWith("/accept") ? json(201, accepted) : json(201, PROPOSAL)));
    const { router } = renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Show birthdays");
    const op2 = await screen.findByRole("checkbox", { name: /op\.2/ });
    const op3 = screen.getByRole("checkbox", { name: /op\.3/ });
    fireEvent.click(op2);
    expect((op3 as HTMLInputElement).checked).toBe(false);
    // Checking the link again brings back the add it depends on.
    fireEvent.click(op3);
    expect((op2 as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /op\.1/ }));
    expect(screen.getByText("2 of 3 selected. Unchecked changes are rejected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept selected" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/accept"))?.body).toEqual({ opIds: ["op.2", "op.3"] }));
    await waitFor(() => {
      const p = new URLSearchParams(router.state.location.search);
      expect([p.get("evolution"), p.get("realization"), p.get("panel"), p.get("proposal")]).toEqual(["evolution.9", "real.9", null, null]);
    });
  });

  it("answers a question inline and shows the revised proposal", async () => {
    const asking: Proposal = { ...PROPOSAL, ops: [], problems: [], questions: [{ id: "q.1", text: "Which screen should show birthdays?" }] };
    const calls = stubApi((c) => (c.url.endsWith("/reply") ? json(200, PROPOSAL) : json(201, asking)));
    renderApp(`${WORK}?panel=intent`, undefined, api);
    await describe_("Birthdays");
    const box = await screen.findByLabelText("Which screen should show birthdays?");
    expect(screen.queryByRole("button", { name: "Accept selected" })).toBeNull();
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
    expect((screen.getByRole("button", { name: "Accept selected" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("provider fake")).toBeTruthy();
  });

  it("the Work header opens and closes the panel", async () => {
    const { router } = renderApp(WORK);
    fireEvent.click(await screen.findByRole("button", { name: "Describe a change" }));
    await waitFor(() => expect(router.state.location.search).toContain("panel=intent"));
    expect(await screen.findByRole("heading", { level: 2, name: "Describe a change" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("panel="));
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
