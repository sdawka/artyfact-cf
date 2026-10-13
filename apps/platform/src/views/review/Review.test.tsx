import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictReport } from "../../../shared/api";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { SYSTEM, candidate, commit, realization } from "../work/testData";
import { EVO1, GATES, REQUIRED, evalFor, json, seed, stubApi } from "../work/testSeed";

const BLOCKING = GATES["cand.1"].filter((g) => g.blocking).length;

const BASE = `/s/${SYSTEM}/r/head`;
const REVIEW = `${BASE}/review`;
const TITLE = "Private contact foundation";

afterEach(() => vi.unstubAllGlobals());

const head = commit({ id: "sc-1", parent: null });
const evaluated = realization({ status: "evaluated", candidate: "cand.1", baseRevision: "sc-1" });
const amendment = realization({ id: "realization.g", target: "genome", status: "awaiting-admin", candidate: "cand.g", agent: { id: "agent-genome", role: "implementer" } });
const queueSeed = (extra: Parameters<typeof seed>[0] = {}) =>
  seed({ realizations: [evaluated, amendment], candidates: [candidate({ baseRevision: "sc-1" })], commits: [head], ...extra });
const queue = () => screen.findByRole("region", { name: /Waiting on you/ });

describe("Review queue", () => {
  it("says nothing is waiting when the queue is empty", async () => {
    renderApp(REVIEW, undefined, seed({ realizations: [realization({ status: "working" })] }));
    expect(await screen.findByText("Nothing is waiting on you.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
  });

  it("lists one row per decision grouped by Evolution: amendment, candidate, promotion", async () => {
    renderApp(REVIEW, undefined, queueSeed());
    const q = await queue();
    expect(within(q).getByRole("heading", { name: /Waiting on you\s*3/ })).toBeTruthy();
    const group = within(q).getByRole("region", { name: TITLE });
    const rows = within(group).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["amendment", "candidate", "promotion"]);
    expect(rows[1]!.textContent).toMatch(/candidate.*agent-alpha.*implementer.*cand\.1.*base = head/);
    expect(rows[0]!.textContent).toMatch(/amendment.*agent-genome/);
    expect(rows[2]!.textContent).toMatch(/promotion.*ready to promote/);
    expect(screen.getByText("Select a decision from the queue.")).toBeTruthy();
  });

  it("opens a candidate row on the right with its review tabs and marks it current", async () => {
    const { router } = renderApp(REVIEW, undefined, queueSeed());
    const q = await queue();
    fireEvent.click(within(q).getAllByRole("link").find((l) => l.getAttribute("data-kind") === "candidate")!);
    await waitFor(() => expect(router.state.location.search).toBe(`?evolution=${EVO1}&realization=realization.1`));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect(within(review).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Semantic delta", "Files", "Evaluations"]);
    expect(within(q).getAllByRole("link").find((l) => l.getAttribute("aria-current") === "true")!.getAttribute("data-kind")).toBe("candidate");
  });

  it("opens the amendment with its Amendment tab", async () => {
    renderApp(`${REVIEW}?evolution=${EVO1}&realization=realization.g`, undefined, queueSeed({ candidates: [candidate({ baseRevision: "sc-1" }), candidate({ id: "cand.g", realization: "realization.g" })] }));
    const review = await screen.findByRole("region", { name: "Review realization.g" });
    expect(within(review).getByRole("tab", { name: "Amendment" })).toBeTruthy();
  });

  it("opens the promotion desk from the promotion row", async () => {
    const { router } = renderApp(REVIEW, undefined, queueSeed());
    const q = await queue();
    fireEvent.click(within(q).getAllByRole("link").find((l) => l.getAttribute("data-kind") === "promotion")!);
    await waitFor(() => expect(router.state.location.search).toBe(`?evolution=${EVO1}&panel=promote`));
    expect(await screen.findByRole("heading", { name: `Promote ${TITLE}` })).toBeTruthy();
  });

  it("marks a candidate built on an earlier head as stale, behind by the distance, and offers no promotion", async () => {
    const next = commit({ id: "sc-2", parent: "sc-1" });
    renderApp(REVIEW, undefined, queueSeed({ realizations: [evaluated], commits: [head, next] }));
    const rows = within(await queue()).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["stale"]);
    expect(within(rows[0]!).getByText("behind by 1")).toBeTruthy();
  });

  it("shows the typed conflict chips on a row", async () => {
    const soft: ConflictReport = { kind: "soft-semantic", candidates: ["cand.1", "cand.2"], subjects: [], nodes: ["screen.people"], message: "Both edit people" };
    renderApp(REVIEW, undefined, queueSeed({ conflicts: [soft] }));
    const row = within(await queue()).getAllByRole("link").find((l) => l.getAttribute("data-kind") === "candidate")!;
    expect(within(row).getByRole("list", { name: "Conflicts" }).textContent).toMatch(/≈ soft-semantic/);
  });

  it("preselects ?candidates= for composition and links to its promotion", async () => {
    renderApp(`${REVIEW}?candidates=cand.1`, undefined, queueSeed());
    const panel = await screen.findByRole("region", { name: "Selected for composition" });
    expect(within(panel).getByText("cand.1")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: `Promote ${TITLE}` }).getAttribute("href")).toBe(`${REVIEW}?candidates=cand.1&evolution=${EVO1}&panel=promote`);
    expect(within(await queue()).getByText("selected for composition")).toBeTruthy();
  });

  it("works under a Thing workspace and keeps its links there", async () => {
    renderApp(`${BASE}/things/thing.webapp/review`, undefined, queueSeed());
    const q = await queue();
    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
    expect(within(q).getAllByRole("link")[0]!.getAttribute("href")).toContain(`${BASE}/things/thing.webapp/review?`);
  });

  it("feeds the rail count from the same queue", async () => {
    renderApp(`${BASE}/overview`, undefined, queueSeed());
    expect(await screen.findByRole("link", { name: "Review, 3 waiting" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "3 waiting for review" }).getAttribute("href")).toBe(REVIEW);
  });
});

describe("PromotionPanel", () => {
  const url = `${REVIEW}?evolution=${EVO1}&panel=promote&candidates=cand.1`;
  const allPass = () => REQUIRED.map((c) => evalFor(c));
  const submit = () => screen.getAllByRole("button", { name: "Promote" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
  const fill = async () => {
    fireEvent.change(await screen.findByLabelText("Rationale"), { target: { value: "All required gates pass" } });
  };

  it("is disabled in fixture mode", async () => {
    renderApp(url, undefined, seed({ evals: allPass() }));
    await fill();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/Promotion needs the platform API/)).toBeTruthy();
  });

  it("is disabled while a required criterion is unknown or not run, and names it", async () => {
    const evals = allPass().filter((e) => e.criterion !== "C.webapp.exists").concat(evalFor("C.webapp.exists", { verdict: "unknown", execution: "completed" }));
    renderApp(url, undefined, seed({ api: true, evals }));
    await fill();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/1 required gate is not pass\/completed: C\.webapp\.exists/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Required gate coverage" });
    const row = within(table).getByText("C.webapp.exists", { exact: false }).closest("tr")!;
    expect(row.querySelector('[data-verdict="unknown"]')).not.toBeNull();
    expect(row.querySelector('[data-verdict="pass"]')).toBeNull();
  });

  it("renders a criterion fail when one hook fails and another passes, never green", async () => {
    const evals = allPass().filter((e) => e.criterion !== "C.webapp.exists").concat(
      evalFor("C.webapp.exists", { id: "e.rules", hook: "hook.rules", verdict: "fail", startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:00:00Z" }),
      evalFor("C.webapp.exists", { id: "e.semantic", hook: "hook.semantic", verdict: "pass", startedAt: "2026-10-01T00:00:09Z", finishedAt: "2026-10-01T00:00:09Z" }),
    );
    renderApp(url, undefined, seed({ api: true, evals }));
    await fill();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/1 required gate is not pass\/completed: C\.webapp\.exists/)).toBeTruthy();
    const row = screen.getByRole("table", { name: "Required gate coverage" }).querySelector('[title="Criterion: C.webapp.exists"]')!.closest("tr")!;
    expect(row.querySelector('[data-verdict="fail"]')).not.toBeNull();
    expect(row.querySelector('[data-verdict="pass"]')).toBeNull();
    expect(within(row).getByText("hook.rules")).toBeTruthy();
  });

  it("shows the server's gate set and refuses to judge a candidate the server reported none for", async () => {
    // Only C.webapp.exists is in the server's set: the table follows it, not a local selection rule.
    renderApp(url, undefined, seed({ api: true, evals: allPass(), gates: { "cand.1": [{ id: "C.webapp.exists", severity: "hard", blocking: true }] } }));
    await fill();
    const table = screen.getByRole("table", { name: "Required gate coverage" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(submit().disabled).toBe(false);
  });

  it("is disabled with a reason when the server did not report the gate set", async () => {
    renderApp(url, undefined, seed({ api: true, evals: allPass(), gates: null }));
    await fill();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/reported no promotion gate for cand\.1/)).toBeTruthy();
  });

  it("stays disabled with a reason while board data loads", async () => {
    renderApp(url, undefined, (qc) => {
      seed({ api: true, evals: allPass() })(qc);
      qc.removeQueries({ queryKey: qk.evolutions(SYSTEM) });
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });
    await fill();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Loading board data…")).toBeTruthy();
  });

  it("does not let a waived verdict satisfy a required gate", async () => {
    const evals = allPass().map((e) => (e.criterion === "C.webapp.exists" ? { ...e, verdict: "waived" as const } : e));
    renderApp(url, undefined, seed({ api: true, evals }));
    await fill();
    expect(submit().disabled).toBe(true);
    const row = within(screen.getByRole("table", { name: "Required gate coverage" })).getAllByText(/C\.webapp\.exists/)[0]!.closest("tr")!;
    expect(row.querySelector('[data-verdict="waived"]')).not.toBeNull();
  });

  it("treats a pass that never completed as not run", async () => {
    const evals = allPass().map((e) => (e.criterion === "C.webapp.exists" ? { ...e, execution: "queued" as const } : e));
    renderApp(url, undefined, seed({ api: true, evals }));
    await fill();
    expect(submit().disabled).toBe(true);
    expect(screen.getAllByText(/C\.webapp\.exists/).length).toBeGreaterThan(0);
  });

  it("is enabled when every required gate passes and a rationale is written", async () => {
    renderApp(url, undefined, seed({ api: true, evals: allPass() }));
    await screen.findByLabelText("Rationale");
    expect(submit().disabled).toBe(true);
    await fill();
    expect(submit().disabled).toBe(false);
    expect(screen.getByText(/none \(first promotion\)/)).toBeTruthy();
    const summary = screen.getByTestId("gates-summary");
    expect(summary.textContent).toBe(`✓ ${BLOCKING} pass`);
    expect(summary.getAttribute("data-tone")).toBe("pass");
  });

  it("summarises the gates without the success tone while one is unknown", async () => {
    const evals = allPass().filter((e) => e.criterion !== "C.webapp.exists").concat(evalFor("C.webapp.exists", { verdict: "unknown", execution: "completed" }));
    renderApp(url, undefined, seed({ api: true, evals }));
    await fill();
    const summary = screen.getByTestId("gates-summary");
    expect(summary.textContent).toBe(`${BLOCKING - 1} pass · 1 unknown`);
    expect(summary.getAttribute("data-tone")).toBeNull();
  });

  it("shows soft overlap as a separate advisories group that needs acknowledging, not blocking", async () => {
    const soft: ConflictReport = { kind: "soft-semantic", candidates: ["cand.1", "cand.2"], subjects: [], nodes: ["screen.people"], message: "Overlap on people screen" };
    renderApp(url, undefined, seed({ api: true, evals: allPass(), conflicts: [soft] }));
    await fill();
    const adv = screen.getByRole("group", { name: "Advisories" });
    expect(within(adv).getByText(/Overlap on people screen/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Blocking" })).toBeNull();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Acknowledge the advisories in the rationale.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /rationale addresses the 1 advisory/ }));
    expect(submit().disabled).toBe(false);
  });

  it("blocks on a hard conflict between selected candidates", async () => {
    const hard: ConflictReport = { kind: "hard-semantic", candidates: ["cand.1"], subjects: [], nodes: ["policy.ownerOnly"], message: "Contradicting claims" };
    renderApp(url, undefined, seed({ api: true, evals: allPass(), conflicts: [hard] }));
    await fill();
    expect(submit().disabled).toBe(true);
    expect(within(screen.getByRole("group", { name: "Blocking" })).getByText(/Contradicting claims/)).toBeTruthy();
  });

  it("renders the head-moved message and refresh action on a 409", async () => {
    stubApi(() => json(409, { error: { code: "stale-base", message: "stale", details: { currentHead: "deadbeefcafe" } } }), allPass());
    renderApp(url, undefined, seed({ api: true, evals: allPass(), commits: [commit({ id: "oldhead0000" })] }));
    await fill();
    expect(screen.getAllByText(/oldhead0000/).length).toBeGreaterThan(0);
    fireEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("deadbee");
    expect(alert.textContent).toContain("re-evaluate");
    // The agent's way out: no rebase command exists, so rebase the fork on the new head and submit again.
    expect(alert.textContent).toMatch(/rebases the fork on deadbee and submits again: artyfact submit/);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it("renders blocking and advisory groups from a server refusal", async () => {
    stubApi(() => json(409, { error: { code: "blocked", message: "refused", details: { blocking: [{ candidate: "cand.1", criterion: "C.webapp.exists", severity: "hard", verdict: "missing", execution: "missing" }], advisories: [{ candidate: "cand.1", criterion: "C.webapp.screen.people", severity: "soft", verdict: "unknown", execution: "completed" }] } } }), allPass());
    renderApp(url, undefined, seed({ api: true, evals: allPass() }));
    await fill();
    fireEvent.click(submit());
    const blocking = await screen.findByRole("group", { name: "Blocking" });
    expect(within(blocking).getByRole("button", { name: /Web app exists/ })).toBeTruthy();
    expect(within(blocking).getByText("C.webapp.exists")).toBeTruthy();
    expect(blocking.querySelector('[data-verdict="not-run"]')).not.toBeNull();
    const adv = screen.getByRole("group", { name: "Advisories" });
    expect(within(adv).getByText("C.webapp.screen.people")).toBeTruthy();
    expect(adv.querySelector('[data-verdict="unknown"]')).not.toBeNull();
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/The server refused: 1 blocking item/)).toBeTruthy();
    fireEvent.click(within(blocking).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Blocking" })).toBeNull());
  });

  it("confirms success and links to the Changelog", async () => {
    stubApi(() => json(200, { commit: commit({ id: "newcommit0000" }), rejected: ["cand.2"] }), allPass());
    const fx: string[] = [];
    const onFx = (e: Event) => fx.push((e as CustomEvent<{ kind: string; strength?: number }>).detail.kind);
    window.addEventListener("artyfact:fx", onFx);
    renderApp(url, undefined, seed({ api: true, evals: allPass() }));
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText(/newcomm/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Changelog" }).getAttribute("href")).toContain("commit=newcommit0000");
    window.removeEventListener("artyfact:fx", onFx);
    expect(fx).toContain("promoted");
  });
});
