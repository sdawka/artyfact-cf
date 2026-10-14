import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictReport, SystemImportReview, ProposalPlanNode, SystemSummary } from "../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
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
    expect(within(q).getByRole("heading", { name: /Waiting on you\s*2/ })).toBeTruthy();
    const group = within(q).getByRole("region", { name: TITLE });
    const rows = within(group).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["amendment", "candidate", "promotion"]);
    expect(rows[1]!.textContent).toMatch(/candidate.*agent-alpha.*implementer.*cand\.1.*base = head/);
    expect(rows[0]!.textContent).toMatch(/amendment.*agent-genome/);
    expect(rows[2]!.textContent).toMatch(/promotion.*ready to promote/);
    // Promotion rows carry their Evolution in the accessible name, so two are never named alike.
    expect(within(group).getByRole("link", { name: new RegExp(`promotion.*${TITLE} \\(${EVO1}\\)`) })).toBe(rows[2]);
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

  it("shows one typed conflict chip per kind on a row, with the number of conflicts", async () => {
    const soft = (other: string): ConflictReport => ({ kind: "soft-semantic", candidates: ["cand.1", other], subjects: [], nodes: ["screen.people"], message: `Both edit people with ${other}` });
    const file: ConflictReport = { kind: "file", candidates: ["cand.1", "cand.4"], subjects: [], paths: ["src/app.ts"], message: "Same file" };
    renderApp(REVIEW, undefined, queueSeed({ conflicts: [soft("cand.2"), soft("cand.3"), file] }));
    const row = within(await queue()).getAllByRole("link").find((l) => l.getAttribute("data-kind") === "candidate")!;
    const chips = within(within(row).getByRole("list", { name: "Conflicts" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual(["§ file", "≈ soft-semantic · 2 conflicts"]);
  });

  it("starts each opened row afresh: a tab picked on one review does not carry to the next", async () => {
    const other = realization({ id: "realization.2", status: "evaluated", candidate: "cand.2", baseRevision: "sc-1", agent: { id: "agent-beta", role: "implementer" } });
    renderApp(`${REVIEW}?evolution=${EVO1}&realization=realization.1`, undefined, queueSeed({
      realizations: [evaluated, other],
      candidates: [candidate({ baseRevision: "sc-1" }), candidate({ id: "cand.2", realization: "realization.2", baseRevision: "sc-1" })],
    }));
    const first = await screen.findByRole("region", { name: "Review realization.1" });
    fireEvent.click(within(first).getByRole("tab", { name: "Files" }));
    expect(within(first).getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("queue-realization.2"));
    const second = await screen.findByRole("region", { name: "Review realization.2" });
    expect(within(second).getByRole("tab", { name: "Semantic delta" }).getAttribute("aria-selected")).toBe("true");
  });

  it("preselects ?candidates= for composition and links to its promotion", async () => {
    renderApp(`${REVIEW}?candidates=cand.1`, undefined, queueSeed());
    const panel = await screen.findByRole("region", { name: "Selected for composition" });
    expect(within(panel).getByText("cand.1")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: `Promote ${TITLE}` }).getAttribute("href")).toBe(`${REVIEW}?candidates=cand.1&evolution=${EVO1}&panel=promote`);
    expect(within(await queue()).getByText("selected for composition")).toBeTruthy();
  });

  it("says a promotion link names an unknown Evolution instead of claiming nothing waits", async () => {
    renderApp(`${REVIEW}?panel=promote&evolution=evolution.nope`, undefined, queueSeed());
    expect(await screen.findByText("No Evolution evolution.nope on this System.")).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting on you.")).toBeNull();
  });

  it("says a review link names an unknown realization", async () => {
    renderApp(`${REVIEW}?realization=realization.nope`, undefined, seed({ realizations: [] }));
    expect(await screen.findByText("No realization realization.nope on this System.")).toBeTruthy();
  });

  it("shows loading, not an empty queue, while the board loads", async () => {
    renderApp(`${REVIEW}?panel=promote&evolution=${EVO1}`, undefined, (qc) => {
      seed()(qc);
      qc.removeQueries({ queryKey: qk.evolutions(SYSTEM) });
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });
    // The Genome's declared Evolution is known, so the desk opens; an unknown one waits for the board instead of "not found".
    expect(await screen.findByRole("heading", { name: `Promote ${TITLE}` })).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting on you.")).toBeNull();
  });

  it("shows loading for a link to an Evolution the board has not delivered yet", async () => {
    renderApp(`${REVIEW}?panel=promote&evolution=evolution.later`, undefined, (qc) => {
      seed()(qc);
      qc.removeQueries({ queryKey: qk.evolutions(SYSTEM) });
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });
    expect(await screen.findByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(/No Evolution/)).toBeNull();
    expect(screen.queryByText("Nothing is waiting on you.")).toBeNull();
  });

  it("works under a Thing workspace and keeps its links there", async () => {
    renderApp(`${BASE}/things/thing.webapp/review`, undefined, queueSeed());
    const q = await queue();
    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
    expect(within(q).getAllByRole("link")[0]!.getAttribute("href")).toContain(`${BASE}/things/thing.webapp/review?`);
  });

  it("feeds the rail count from the same queue", async () => {
    renderApp(`${BASE}/overview`, undefined, queueSeed());
    // An amendment and an evaluated candidate: 2 waiting, the promotion row is not counted again.
    expect(await screen.findByRole("link", { name: "Review, 2 waiting" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "2 waiting for review" }).getAttribute("href")).toBe(REVIEW);
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
    stubApi(() => json(409, { error: { code: "blocked", message: "refused", details: { criteria: [{ candidate: "cand.1", criterion: "C.webapp.exists", severity: "hard", verdict: "missing", execution: "missing" }], advisories: [{ candidate: "cand.1", criterion: "C.webapp.screen.people", severity: "soft", verdict: "unknown", execution: "completed" }] } } }), allPass());
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

describe("Import review", () => {
  const plan = (id: string, kind: string, title: string, path: string[], children: ProposalPlanNode[] = []): ProposalPlanNode =>
    ({ id, kind, title, path, summary: "", opIds: [], children });
  const ROOT = "system.peopling";
  const tree = [plan("thing.webapp", "thing", "Web app", [ROOT, "thing.webapp"], [
    plan("section.runtime", "section", "Runtime", [ROOT, "thing.webapp", "section.runtime"]),
    plan("GD.prompts", "description", "Prompts", [ROOT, "thing.webapp", "GD.prompts"]),
  ])];
  const review: SystemImportReview = { status: "pending", genomeCommit: "abc1234def5678", tree, findings: [], unmapped: ["public/legacy.html"], unmappedTotal: 240 };
  const summary = (pending: boolean) => ({
    systemId: SYSTEM, title: "Peopling", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "abc1234def5678", evolutionCounts: {}, updatedAt: "",
    ...(pending && { importReview: { status: "pending" as const, genomeCommit: "abc1234def5678", nodes: 3 } }),
  }) as SystemSummary;
  const importSeed = (qc: Parameters<ReturnType<typeof seed>>[0]) => {
    queueSeed()(qc);
    qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });
    qc.setQueryData(qk.systems(), [summary(true)]);
    qc.setQueryData(["importReview", SYSTEM], review);
  };
  const stub = () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith("/api/systems")) return json(200, [summary(false)]);
      if (u.endsWith("/import-review/accept") && init?.method === "POST") {
        return json(200, { review: { ...review, status: "accepted" }, amendment: { evolution: EVO1, realization: "realization.rm", candidate: "cand.rm" }, warnings: ["evolution.1 accepts C.prompts, which removing GD.prompts deletes"] });
      }
      if (u.endsWith("/import-review")) return json(200, review);
      if (u.includes("/model")) return json(200, fixtureBundle());
      if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
      if (u.includes("/history")) return json(200, { commits: [] });
      if (u.includes("/conflicts")) return json(200, { conflicts: [] });
      return json(404, { error: { code: "not-found", message: "no" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("lists a pending import first as 'Import · N nodes', counted once in the rail", async () => {
    stub();
    renderApp(REVIEW, undefined, importSeed);
    const q = await queue();
    expect(within(q).getByRole("heading", { name: /Waiting on you\s*3/ })).toBeTruthy();
    const groups = within(q).getAllByRole("region");
    expect(groups[0]!.getAttribute("aria-labelledby") && within(groups[0]!).getByRole("heading").textContent).toBe("Import");
    const row = within(q).getByTestId("queue-import");
    expect(row.getAttribute("data-kind")).toBe("import");
    expect(row.textContent).toMatch(/Import · 3 nodes.*awaits an admin.*abc1234/);
    expect(screen.getByRole("link", { name: "Review, 3 waiting" })).toBeTruthy();
  });

  it("opens the import review from its row: the tree, the unmapped paths, accept disabled until every node is decided", async () => {
    stub();
    const { router } = renderApp(REVIEW, undefined, importSeed);
    fireEvent.click(within(await queue()).getByTestId("queue-import"));
    await waitFor(() => expect(router.state.location.search).toBe("?panel=import"));
    const panel = await screen.findByRole("article", { name: "Import review" });
    expect(within(await queue()).getByTestId("queue-import").getAttribute("aria-current")).toBe("true");
    expect(within(panel).getByRole("tree", { name: "Imported Genome" })).toBeTruthy();
    expect(within(panel).getByRole("list", { name: "Unmapped app paths" }).textContent).toContain("public/legacy.html");
    expect(within(panel).getByText("Showing the first 1 of 240.")).toBeTruthy();
    // Two-state: no Defer.
    expect(within(panel).queryByRole("button", { name: /^Defer/ })).toBeNull();
    const accept = () => within(panel).getByRole("button", { name: /^Accept import/ }) as HTMLButtonElement;
    fireEvent.change(within(panel).getByLabelText("Accepted interpretation"), { target: { value: "Peopling as written." } });
    expect(accept().disabled).toBe(true);
    expect(within(panel).getByText(/3 nodes are undecided/)).toBeTruthy();
    expect(within(panel).getByTestId("import-summary").textContent).toBe("3 nodes: 0 agreed · 0 rejected · 3 undecided");
    fireEvent.click(within(panel).getByRole("button", { name: "Agree Web app" }));
    expect(within(panel).getByTestId("import-summary").textContent).toBe("3 nodes: 3 agreed · 0 rejected");
    expect(accept().disabled).toBe(false);
    expect(accept().textContent).toBe("Accept import");
    // An import is never rejected whole: no such button, and the panel says what to do instead.
    expect(within(panel).queryByRole("button", { name: "Reject import" })).toBeNull();
    expect(within(panel).getByText(/delete the System and import it again/)).toBeTruthy();
  });

  it("shows an explicit legacy integrity-unreviewed reason without treating it as agreement", async () => {
    stub();
    const legacy = { ...review, integrityUnreviewed: { reason: "Imported before full integrity checks existed", at: "2026-10-14T12:00:00Z" } } as SystemImportReview;
    renderApp(`${REVIEW}?panel=import`, undefined, (qc) => { importSeed(qc); qc.setQueryData(["importReview", SYSTEM], legacy); });
    const panel = await screen.findByRole("article", { name: "Import review" });
    expect(within(panel).getByRole("note").textContent).toContain("Integrity remains unreviewed: Imported before full integrity checks existed");
    expect(within(panel).getByText("awaiting admin")).toBeTruthy();
  });

  it("sends the effectively rejected nodes with the interpretation and links the removal amendment", async () => {
    const fetchMock = stub();
    renderApp(`${REVIEW}?panel=import`, undefined, importSeed);
    const panel = await screen.findByRole("article", { name: "Import review" });
    fireEvent.click(within(panel).getByRole("button", { name: "Agree Web app" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Reject Prompts" }));
    const accept = within(panel).getByRole("button", { name: "Accept import, remove 1 rejected" }) as HTMLButtonElement;
    fireEvent.click(accept);
    expect(within(panel).getByText("Interpretation is required to accept.")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/accept"))).toBe(false);
    fireEvent.change(within(panel).getByLabelText("Accepted interpretation"), { target: { value: "Peopling, without the prompts." } });
    fireEvent.click(accept);
    expect(await within(panel).findByText(/1 rejected node was removed from the Genome/)).toBeTruthy();
    expect(within(panel).getByText("Warning: evolution.1 accepts C.prompts, which removing GD.prompts deletes")).toBeTruthy();
    const body = JSON.parse(String(fetchMock.mock.calls.find(([u]) => String(u).endsWith("/import-review/accept"))![1]!.body));
    expect(body).toEqual({ interpretation: "Peopling, without the prompts.", rejectedNodes: ["GD.prompts"] });
    expect(within(panel).getByRole("link", { name: "Open the removal amendment" }).getAttribute("href")).toBe(`${REVIEW}?evolution=${EVO1}&realization=realization.rm`);
    // The systems refetch has no pending review: the row leaves the queue.
    await waitFor(() => expect(screen.queryByTestId("queue-import")).toBeNull());
  });

  it("drops the row when the review itself is accepted, even while the systems list still says pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith("/api/systems")) return json(200, [summary(true)]);
      if (u.endsWith("/import-review")) return json(200, { ...review, status: "accepted" });
      return json(404, { error: { code: "not-found", message: "no" } });
    }));
    renderApp(REVIEW, undefined, (qc) => {
      importSeed(qc);
      qc.removeQueries({ queryKey: ["importReview", SYSTEM] });
    });
    const q = await queue();
    await waitFor(() => expect(within(q).queryByTestId("queue-import")).toBeNull());
    expect(within(q).getByRole("heading", { name: /Waiting on you\s*2/ })).toBeTruthy();
  });

  it("says so when the System has no import review", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/systems") ? json(200, [summary(false)]) : json(404, { error: { code: "not-found", message: "no review" } })));
    renderApp(`${REVIEW}?panel=import`, undefined, (qc) => { queueSeed()(qc); qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const }); });
    expect(await screen.findByText("This System has no import review.")).toBeTruthy();
  });
});
