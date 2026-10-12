import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictReport } from "../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { PacketViewer } from "./panels/PacketViewer";
import { itemVerdict } from "./panels/PromotionPanel";
import { SYSTEM, candidate, commit, evaluation, realization } from "./testData";

const WORK = `/s/${SYSTEM}/r/head/work`;
const EVO1 = "evolution.1";
// Same selection rule as the server (target unknown here, so both): acceptance criteria plus artifact- and model-targeted ones, promotion-gated, not deferred.
const REQUIRED = fixtureBundle().model.criteria
  .filter((c) => !c.deferred && c.gates.includes("promotion") && (fixtureBundle().model.evolutions[0]!.acceptanceCriteria.includes(c.id) || (c.targetKind === "artifact" || c.targetKind === "model")))
  .map((c) => c.id);
/** The server's gate set for cand.1 (candidates response `gates`): hard criteria block, the rest are advisories. */
const GATES = {
  "cand.1": REQUIRED.map((id) => {
    const severity = fixtureBundle().model.criteria.find((c) => c.id === id)!.severity ?? "hard";
    return { id, severity, blocking: severity === "hard" };
  }),
};
const evalFor = (c: string, o = {}) => evaluation({ id: `e.${c}`, criterion: c, hook: `hook.${c}`, ...o });

interface Seed { gates?: typeof GATES | null; api?: boolean; evals?: ReturnType<typeof evaluation>[]; conflicts?: ConflictReport[]; commits?: ReturnType<typeof commit>[]; realizations?: ReturnType<typeof realization>[]; candidates?: ReturnType<typeof candidate>[] }
const seed = (s: Seed = {}) => (qc: QueryClient) => {
  if (s.api) qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });
  qc.setQueryData(qk.evolutions(SYSTEM), { evolutions: [], realizations: s.realizations ?? [] });
  qc.setQueryData(qk.candidates(SYSTEM, EVO1), { evolution: EVO1, candidates: s.candidates ?? [candidate()], evaluations: [], conflicts: [], ...(s.gates !== null && { gates: s.gates ?? GATES }) });
  qc.setQueryData(qk.evaluations(SYSTEM, undefined), { evaluations: s.evals ?? [] });
  qc.setQueryData(qk.conflicts(SYSTEM), { conflicts: s.conflicts ?? [] });
  qc.setQueryData(qk.history(SYSTEM), { commits: s.commits ?? [] });
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A backend that serves the seeded data again on refetch and answers promote with `promote()`. */
const stubApi = (promote: () => Response, evals: ReturnType<typeof evaluation>[]) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
    if (u.endsWith("/promote")) return promote();
    if (u.includes("/model")) return json(200, fixtureBundle());
    if (u.includes("/candidates")) return json(200, { evolution: EVO1, candidates: [candidate()], evaluations: [], conflicts: [], gates: GATES });
    if (u.includes("/evaluations")) return json(200, { evaluations: evals });
    if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
    if (u.includes("/conflicts")) return json(200, { conflicts: [] });
    if (u.includes("/history")) return json(200, { commits: [] });
    return json(404, { error: { code: "not-found", message: "no" } });
  }));

afterEach(() => vi.useRealTimers());

describe("Work board", () => {
  it("groups the six fixture evolutions by state", async () => {
    renderApp(WORK);
    const proposed = await screen.findByRole("region", { name: /Proposed/ });
    expect(within(proposed).getAllByRole("button")).toHaveLength(5);
    expect(within(screen.getByRole("region", { name: /^Actionable/ })).getAllByRole("button")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: /^Realizing/ })).getByText("none")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(
      ["Proposed", "Genome approved", "Actionable", "Realizing", "Evaluated", "Promoted", "Rejected"],
    );
  });

  it("shows kind, intent, capped affected chips, criteria count and dependencies on a card", async () => {
    renderApp(WORK);
    const one = await screen.findByRole("button", { name: "Private contact foundation" });
    expect(one.textContent).toMatch(/implementation/);
    expect(one.textContent).toMatch(/7 acceptance criteria/);
    expect(one.textContent).toMatch(/0\/7 pass/);
    expect(one.textContent).toMatch(/\+2 more/);
    expect(one.textContent).not.toMatch(/depends on/);
    const proposed = within(screen.getByRole("region", { name: /Proposed/ })).getAllByRole("button");
    expect(proposed.some((c) => /depends on/.test(c.textContent ?? ""))).toBe(true);
    expect(proposed.some((c) => /genome-amendment/.test(c.textContent ?? ""))).toBe(true);
  });

  it("never shows a not-run rollup as green", async () => {
    renderApp(WORK);
    await screen.findByRole("region", { name: /Actionable/ });
    expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
    expect(document.querySelector('[data-verdict="not-run"]')).not.toBeNull();
  });

  it("opens the detail pane from ?evolution= and by clicking a card", async () => {
    const { router } = renderApp(WORK);
    fireEvent.click(await screen.findByRole("button", { name: "Private contact foundation" }));
    await waitFor(() => expect(router.state.location.search).toContain("evolution=evolution.1"));
    expect(await screen.findByRole("heading", { level: 2, name: "Private contact foundation" })).toBeTruthy();
    expect(screen.getByText("No one is working on this Evolution.")).toBeTruthy();
  });
});

describe("StartWorkPanel", () => {
  it("is disabled in fixture mode and says why", async () => {
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`);
    await screen.findByRole("heading", { name: /Start work on/ });
    const submit = screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/Start work needs the platform API/)).toBeTruthy();
    expect(submit.getAttribute("aria-describedby")).toBeTruthy();
  });
});

describe("StartWorkPanel against the API", () => {
  it("submits, then shows the packet and the command once", async () => {
    const cli = "ARTYFACT_TOKEN=tok_x ARTYFACT_SECRET=sec_x npx artyfact start realization.9 --system system.keep-in-touch --evolution evolution.1 --dir ./realization.9";
    const calls: unknown[] = [];
    const auth: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST" && u.endsWith("/evolutions/evolution.1/realizations")) {
        calls.push(JSON.parse(String(init.body)));
        auth.push(new Headers(init.headers).get("authorization"));
        return json(201, { realization: realization({ id: "realization.9" }), packet: { json: {}, markdown: "# Task\n\n- build it" }, token: "tok_x", remote: "https://git/fork", cli });
      }
      return json(200, { evolutions: [], realizations: [] });
    }));
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    fireEvent.change(await screen.findByLabelText("Agent label"), { target: { value: "codex-1" } });
    const tokenInput = screen.getByLabelText("Admin token") as HTMLInputElement;
    expect(tokenInput.type).toBe("password");
    fireEvent.change(tokenInput, { target: { value: "adm_x" } });
    const submit = screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findAllByText(cli)).toHaveLength(1);
    expect(calls).toEqual([{ agentLabel: "codex-1", target: "app", role: "implementer" }]);
    expect(auth).toEqual(["Bearer adm_x"]);
    expect(screen.getByRole("heading", { name: "Task" })).toBeTruthy();
    expect(screen.getByText(/Neither is shown again/)).toBeTruthy();
  });

  it.each([
    [401, /needs the admin token \(401\)/],
    [403, /admin token was refused \(403\)/],
  ])("says plainly when start work is refused with %i", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST") return json(status, { error: { code: status === 401 ? "unauthorized" : "forbidden", message: "nope" } });
      return json(200, { evolutions: [], realizations: [] });
    }));
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    await screen.findByLabelText("Admin token");
    fireEvent.click(screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
  });
});

describe("PacketViewer without a command", () => {
  it("says the command is unavailable and never invents one", () => {
    render(<PacketViewer markdown="# T" cli={null} expiresAt="2026-01-01T01:00:00.000Z" />);
    expect(screen.getByText(/Command unavailable/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("npx artyfact");
  });
});

describe("PacketViewer", () => {
  const CLI = "ARTYFACT_TOKEN=tok_secret npx artyfact start realization.1 --system system.keep-in-touch --evolution evolution.1 --dir ./realization.1";

  it("shows the command once with a countdown from the clock and a not-shown-again warning", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    render(<PacketViewer markdown="# Title\n\n- one\n- two" cli={CLI} expiresAt="2026-01-01T00:12:03.000Z" />);
    expect(screen.getAllByText(CLI)).toHaveLength(1);
    expect(screen.getByText(/Neither is shown again/)).toBeTruthy();
    expect(screen.getByTestId("token-countdown").textContent).toBe("12 min 03 s");
    act(() => void vi.advanceTimersByTime(3_000));
    expect(screen.getByTestId("token-countdown").textContent).toBe("12 min 00 s");
    act(() => void vi.advanceTimersByTime(13 * 60_000));
    expect(screen.getByTestId("token-countdown").textContent).toBe("expired");
    fireEvent.click(screen.getByRole("button", { name: "I have copied it, hide" }));
    expect(screen.queryByText(CLI)).toBeNull();
    expect(document.body.textContent).not.toContain("tok_secret");
  });

  it("renders markdown without injecting HTML", () => {
    const { container } = render(<PacketViewer markdown={'# Heading\n\n<img src=x onerror="alert(1)"> **bold** `code`\n\n```\n<script>x</script>\n```\n\n1. first'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy();
    expect(container.textContent).toContain("<script>x</script>");
  });
});

describe("RealizationRow", () => {
  const conflicts: ConflictReport[] = [{ kind: "soft-semantic", candidates: ["cand.1", "cand.2"], subjects: [], nodes: ["screen.people"], paths: [], message: "Both edit the people screen" }];

  it("shows agent, fork, last checkpoint and typed conflict chips", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [realization(), realization({ id: "realization.2", agent: { id: "agent-beta", role: "reviewer" }, checkpoints: [] })], conflicts }));
    const row = await screen.findByTestId("realization-realization.1");
    expect(within(row).getByText("agent-alpha")).toBeTruthy();
    expect(within(row).getByText("fork-alpha")).toBeTruthy();
    expect(within(row).getByText("fedcba9")).toBeTruthy();
    expect(within(row).getByText(/Scaffolded the app/)).toBeTruthy();
    expect(within(row).getByText(/soft-semantic/)).toBeTruthy();
    expect(within(screen.getByTestId("realization-realization.2")).getByText(/Last checkpoint:\s*unknown/)).toBeTruthy();
  });

  it("keeps the same DOM node when a refetch returns equal data", async () => {
    const { qc } = renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [realization()] }));
    const row = await screen.findByTestId("realization-realization.1");
    const data = qc.getQueryData(qk.evolutions(SYSTEM));
    act(() => void qc.setQueryData(qk.evolutions(SYSTEM), structuredClone(data)));
    expect(screen.getByTestId("realization-realization.1")).toBe(row);
  });
});

describe("CandidateReview", () => {
  const url = `${WORK}?evolution=${EVO1}&realization=realization.1`;
  const withCandidate = (extra = {}) => seed({ realizations: [realization()], candidates: [candidate(extra)] });

  it("groups subjects, marks unmapped files and toggles composition selection", async () => {
    const { router } = renderApp(url, undefined, withCandidate());
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect(within(review).getByText("Changed (operation unknown)")).toBeTruthy();
    expect(within(review).getByText("Unmapped")).toBeTruthy();
    fireEvent.click(within(review).getByRole("tab", { name: "Files" }));
    const files = within(review).getByRole("list", { name: "Changed files" });
    expect(within(files).getByText("src/odd.ts").parentElement?.textContent).toMatch(/unmapped/);
    expect(within(files).getByText("src/app.ts").parentElement?.textContent).not.toMatch(/unmapped/);
    fireEvent.click(within(review).getByRole("button", { name: "Select for composition" }));
    await waitFor(() => expect(router.state.location.search).toContain("candidates=cand.1"));
    expect(await within(review).findByRole("button", { name: "Selected for composition" })).toBeTruthy();
  });

  it("uses per-subject operations when the backend sends them", async () => {
    renderApp(url, undefined, withCandidate({ subjectDelta: { added: ["screen.people"], changed: ["thing.webapp"], removed: [] } }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect(within(review).getByText("Added")).toBeTruthy();
    expect(within(review).queryByText("Changed (operation unknown)")).toBeNull();
  });

  it("lists this candidate's evaluations and empty-states honestly", async () => {
    renderApp(url, undefined, seed({ realizations: [realization()], candidates: [candidate()], evals: [evalFor("C.webapp.exists")] }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    fireEvent.click(within(review).getByRole("tab", { name: "Evaluations" }));
    expect(within(review).getAllByRole("row")).toHaveLength(2);
  });

  it("mounts the amendment review for genome realizations with the evolution id and system id", async () => {
    renderApp(url, undefined, seed({ realizations: [realization({ target: "genome" })], candidates: [candidate()] }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    fireEvent.click(within(review).getByRole("tab", { name: "Amendment" }));
    expect(await within(review).findByText(/amendment review/i)).toBeTruthy();
  });

  it("says there is nothing to review before a candidate is submitted", async () => {
    renderApp(url, undefined, seed({ realizations: [realization()], candidates: [] }));
    expect(await screen.findByText(/nothing to review/)).toBeTruthy();
  });
});

describe("PromotionPanel", () => {
  const url = `${WORK}?evolution=${EVO1}&panel=promote&candidates=cand.1`;
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

  it("confirms success and links to History", async () => {
    stubApi(() => json(200, { commit: commit({ id: "newcommit0000" }), rejected: ["cand.2"] }), allPass());
    renderApp(url, undefined, seed({ api: true, evals: allPass() }));
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText(/newcomm/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in History" }).getAttribute("href")).toContain("commit=newcommit0000");
  });
});

describe("itemVerdict (server gate items)", () => {
  it("falls back to the verdict when execution is absent; only pass needs a completed run", () => {
    expect(itemVerdict({ criterion: "c", verdict: "fail" })).toBe("fail");
    expect(itemVerdict({ criterion: "c", verdict: "pass" })).toBe("unknown");
    expect(itemVerdict({ criterion: "c", verdict: "pass", execution: "completed" })).toBe("pass");
    expect(itemVerdict({ criterion: "c", verdict: "pass", execution: "running" })).toBe("not-run");
    expect(itemVerdict({ criterion: "c", verdict: "missing", execution: "missing" })).toBe("not-run");
    expect(itemVerdict({ criterion: "c", verdict: "fail", execution: "error" })).toBe("unknown");
  });
});
