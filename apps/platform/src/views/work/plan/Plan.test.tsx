import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftRealizationPlanResponse, RealizationPlan } from "../../../../shared/lifecycle";
import { ADMIN_TOKEN_KEY } from "@/api/adminToken";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { commandLines, TOKEN_REASON } from "./lib";
import { PUBLIC_PLAN_READS } from "./queries";
import { makePlan, task } from "./testPlan";

const SID = "system.peopling";
type Call = { method: string; url: string; body: unknown; auth: string | null };

function stub(routes: { plan?: RealizationPlan; draft?: DraftRealizationPlanResponse; created?: RealizationPlan } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.authorization ?? null });
    const plan = routes.plan ?? makePlan();
    if (u.endsWith("/realization-plans/draft")) return Response.json(routes.draft);
    if (u.endsWith("/realization-plans")) return method === "POST" ? Response.json(routes.created ?? plan) : Response.json({ plans: [plan] });
    if (u.endsWith("/select")) return Response.json(plan);
    if (u.includes("/realization-plans/")) return Response.json(plan);
    if (u.endsWith("/api/systems")) return Response.json([]);
    if (u.endsWith(`/api/systems/${SID}`)) return Response.json({ systemId: SID, planCounts: { open: 1, awaitingAgent: 2, submitted: 0, integrated: 0 } });
    return Response.json({ parts: [] });
  }));
  return calls;
}

function render(url: string, opts: { token?: boolean; realizations?: unknown[] } = {}) {
  if (opts.token !== false) sessionStorage.setItem(ADMIN_TOKEN_KEY, "admin");
  renderApp(url, undefined, (qc) => {
    qc.setQueryData(qk.model(SID, "head"), { ...fixtureBundle(), source: "api" });
    qc.setQueryData(qk.evolutions(SID), {
      evolutions: [{ id: "evolution.9", title: "Birthdays in the Genome", intent: "", state: "promoted", kind: "genome-amendment", affectedNodes: [], affectedClaims: [], genomeDelta: [], acceptanceCriteria: [], requiredEvidence: [], dependsOn: [], risk: "low", realizations: [] }],
      realizations: opts.realizations ?? [],
    });
  });
}

const clip = () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

afterEach(() => sessionStorage.clear());

describe("Realization plans", () => {
  it("drafts, edits (rename, merge, split, remove) and creates the edited plan", async () => {
    const d = (id: string, o = {}) => ({ id, title: `Draft ${id}`, artifactId: "artifact.web", steps: [`do ${id}`], dependsOn: [], readNodes: [], writeNodes: [`n.${id}`], checks: [], ...o });
    const draft: DraftRealizationPlanResponse = {
      request: { title: "Birthdays", tasks: [d("a"), d("b", { writeNodes: ["n.b1", "n.b2"] }), d("c"), d("e", { dependsOn: ["c"] })] },
      analysis: { waves: [["a", "b", "c"], ["e"]], conflicts: [] },
      problems: [{ taskId: "c", severity: "warning", message: "no checks" }],
      provenance: { planner: { provider: "fake", model: "fake" }, genomeCommit: "abcdef0123", evolutionIds: ["evolution.9"], nodes: [], fake: true, fallback: false },
    };
    const calls = stub({ draft });
    render(`/s/${SID}/r/head/work?panel=plan`);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Birthdays in the Genome/ }));
    const draftBtn = screen.getByRole("button", { name: "Draft tasks" }) as HTMLButtonElement;
    await waitFor(() => expect(draftBtn.disabled).toBe(false));
    fireEvent.click(draftBtn);
    expect(await screen.findByText(/As drafted: wave 1 \(a, b, c\); wave 2 \(e\)/)).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith("/draft"))).toMatchObject({ method: "POST", body: { evolutionIds: ["evolution.9"], nodes: [] }, auth: "Bearer admin" });
    expect(screen.getByRole("list", { name: "Draft problems" }).textContent).toContain("warning: c: no checks");

    fireEvent.change(screen.getByLabelText("Title of a"), { target: { value: "Cards" } });
    expect(screen.getByTestId("draft-waves").textContent).toBe("Edited: waves are recomputed when the plan is created.");
    // Split b: move n.b2 to a new task.
    const b = screen.getByTestId("draft-b");
    fireEvent.click(within(b).getByRole("checkbox", { name: "Move n.b2" }));
    fireEvent.change(within(b).getByLabelText("New task title"), { target: { value: "B two" } });
    fireEvent.click(within(b).getByRole("button", { name: "Split" }));
    // Merge a and b.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select “Cards” to merge" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select “Draft b” to merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge selected (2)" }));
    // Remove c: e loses its dependency on it.
    fireEvent.click(screen.getByRole("button", { name: "Remove Draft c" }));
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/realization-plans"))).toBe(true));
    const created = calls.find((c) => c.method === "POST" && c.url.endsWith("/realization-plans"))!.body as { title: string; tasks: { id: string; title: string; writeNodes: string[]; dependsOn: string[] }[] };
    expect(created.title).toBe("Birthdays");
    expect(created.tasks.map((t) => [t.id, t.title, t.writeNodes, t.dependsOn])).toEqual([
      ["a", "Cards + Draft b", ["n.a", "n.b1"], []],
      ["b-2", "B two", ["n.b2"], []],
      ["e", "Draft e", ["n.e"], []],
    ]);
    expect(await screen.findByTestId("plan-counts")).toBeTruthy();
  });

  it("shows waves from 1 with task cards, conflicts and credential-free agent commands; Copy all respects Hide", async () => {
    stub();
    const writeText = clip();
    render(`/s/${SID}/r/head/work?plan=plan.one`);
    const board = await screen.findByRole("group", { name: "Waves" });
    const w1 = within(board).getByRole("region", { name: "Wave 1 · 2 tasks" });
    const w2 = within(board).getByRole("region", { name: "Wave 2 · 1 task" });
    expect(within(w1).getAllByRole("article")).toHaveLength(2);
    const t1 = screen.getByTestId("task-t1");
    expect(t1.querySelector('[data-status="pending"]')).toBeTruthy();
    expect(within(t1).getByText("+1 more")).toBeTruthy();
    expect(within(t1).getByText("awaits an agent")).toBeTruthy();
    const t3 = screen.getByTestId("task-t3");
    expect(t3.querySelector('[data-status="blocked"]')).toBeTruthy();
    expect(within(t3).getByText("waits on Task t1, Task t2")).toBeTruthy();
    expect(within(t3).getByRole("list", { name: "Conflicts" }).textContent).toContain("source · Task t2");
    // Wave 2 has no command: t3 waits on t1 and t2.
    expect(within(w2).queryByText(/Agent commands/)).toBeNull();
    const p = { id: "plan.one", systemId: SID };
    expect(within(w1).getByRole("listitem", { name: "Command for Task t1" }).textContent).toContain(commandLines("claim", p, "t1"));
    expect(document.body.textContent).not.toMatch(/TOKEN=|Bearer|secret|--json/);

    // "Copy all" is the first button of the wave's command section; it reads "Copied" for a moment after a click.
    const copyAll = () => within(within(w1).getByRole("region", { name: "Agent commands · wave 1" })).getAllByRole("button")[0]!;
    fireEvent.click(copyAll());
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${commandLines("claim", p, "t1")}\n${commandLines("claim", p, "t2")}`));
    fireEvent.click(within(w1).getByRole("button", { name: "Hide the command for Task t1" }));
    fireEvent.click(copyAll());
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(commandLines("claim", p, "t2")));
    fireEvent.click(within(w1).getByRole("button", { name: "Hide the command for Task t2" }));
    const all = within(w1).getByRole("button", { name: "Copy all" });
    expect((all as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById(all.getAttribute("aria-describedby")!)!.textContent).toBe("Every command is hidden.");
  });

  it("opens a task's detail and selects its reviewed candidate, prefilled from the attempt's realization", async () => {
    const plan = makePlan({ tasks: [task("t1", { status: "submitted", attempts: [{ id: "att", taskId: "t1", generation: 1, realizationId: "r.t1", status: "submitted", agentLabel: "claude", leaseExpiresAt: "2026-10-13T00:00:00Z", createdAt: "" }] }), task("t2"), task("t3", { dependsOn: ["t1", "t2"] })] });
    const calls = stub({ plan });
    render(`/s/${SID}/r/head/work?plan=plan.one&task=t1`, { realizations: [{ id: "r.t1", evolution: "", candidate: "cand.t1", status: "submitted" }] });
    const detail = await screen.findByTestId("task-detail");
    expect(within(detail).getByText("Wave 1: it waits on no other task and does not conflict with “Task t2”.")).toBeTruthy();
    expect(within(detail).getByText("src/t1/**")).toBeTruthy();
    expect(within(detail).getByText("Do t1")).toBeTruthy();
    expect(within(detail).getByText(/claude · submitted · generation 1/)).toBeTruthy();
    const input = within(detail).getByLabelText("Reviewed candidate ID for Task t1") as HTMLInputElement;
    expect(input.value).toBe("cand.t1");
    fireEvent.click(within(detail).getByRole("button", { name: "Select reviewed Task result" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/tasks/t1/select"))).toMatchObject({ method: "POST", body: { candidateId: "cand.t1" } }));
    // Integrate waits on every selection.
    expect(screen.getByRole("button", { name: "Integrate selected Task results" }).hasAttribute("disabled")).toBe(true);
  });

  it("explains why writes are off without a token, and reads plans only when reads are public", async () => {
    const calls = stub();
    render(`/s/${SID}/r/head/work?panel=plan`, { token: false });
    const draftBtn = await screen.findByRole("button", { name: "Draft tasks" });
    expect((draftBtn as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(document.getElementById(draftBtn.getAttribute("aria-describedby")!)!.textContent).toBe(TOKEN_REASON));
    if (PUBLIC_PLAN_READS) {
      await waitFor(() => expect(calls.some((c) => c.url.endsWith("/realization-plans"))).toBe(true));
      expect(calls.find((c) => c.url.endsWith("/realization-plans"))!.auth).toBeNull();
      expect(await screen.findByRole("button", { name: "Implement birthdays" })).toBeTruthy();
    } else {
      expect(await screen.findByText("Set the admin token to load and manage Realization plans.")).toBeTruthy();
      expect(calls.some((c) => c.url.includes("/realization-plans"))).toBe(false);
    }
  });
});
