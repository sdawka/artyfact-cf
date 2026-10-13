import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StartWaveResponse, TaskPlan } from "../../../../shared/api";
import { renderApp } from "@/testing/render";
import { SYSTEM, realization } from "../testData";
import { EVO1, json, seed } from "../testSeed";
import { SAMPLE_PLAN } from "./sample";

const WORK = `/s/${SYSTEM}/r/head/work`;
const PLAN_URL = `/api/systems/${SYSTEM}/evolutions/${EVO1}/plan`;
const systems = () => json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);

interface Call { method: string; url: string; body: unknown; auth: string | null }

/** A backend holding one plan (or none: 404 `no-plan`) that answers the plan routes and records each write. */
function stubPlanApi(initial: TaskPlan | null, opts: { startWave?: (n: number) => Response } = {}) {
  let plan = initial;
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u.endsWith("/api/systems")) return systems();
    if (method !== "GET") calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") });
    if (u === PLAN_URL && method === "GET") return plan ? json(200, plan) : json(404, { error: { code: "no-plan", message: "No plan for evolution.1." } });
    if (u === PLAN_URL && method === "POST") return json(201, (plan = SAMPLE_PLAN));
    if (u === PLAN_URL && method === "PUT") {
      const body = JSON.parse(String(init!.body)) as { tasks: TaskPlan["tasks"] };
      const fp = new Map(plan!.tasks.map((t) => [t.id, t.footprint]));
      plan = { ...plan!, tasks: body.tasks.map((t) => ({ ...t, footprint: fp.get(t.id) ?? { globs: [], paths: [], unmatched: [], entryFiles: [] } })) };
      return json(200, plan);
    }
    const wave = /\/waves\/(\d+)\/start$/.exec(u);
    if (wave && method === "POST") return opts.startWave?.(Number(wave[1])) ?? json(404, { error: { code: "not-found", message: "no" } });
    if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
    return json(404, { error: { code: "not-found", message: "no" } });
  }));
  return { calls, set: (p: TaskPlan) => (plan = p) };
}

const withAdmin = async (run: () => Promise<void>) => {
  sessionStorage.setItem("artyfact.adminToken", "adm_x");
  try {
    await run();
  } finally {
    sessionStorage.clear();
  }
};

const noGreen = () => {
  expect(document.querySelector('[data-tone="pass"]')).toBeNull();
  expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
};

afterEach(() => vi.useRealTimers());

describe("Plan panel", () => {
  it("adds a Plan toggle before Start work that opens ?panel=plan", async () => {
    stubPlanApi(SAMPLE_PLAN);
    const { router } = renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ api: true }));
    const head = (await screen.findByRole("heading", { level: 2, name: "Private contact foundation" })).closest("header")!;
    const names = within(head).getAllByRole("button").map((b) => b.textContent);
    expect(names.indexOf("Plan")).toBeLessThan(names.indexOf("Start work"));
    fireEvent.click(within(head).getByRole("button", { name: "Plan" }));
    await waitFor(() => expect(router.state.location.search).toContain("panel=plan"));
    expect(await screen.findByTestId("plan-counts")).toBeTruthy();
  });

  it("empty state: Plan tasks POSTs with the header token and shows the waves", async () => {
    await withAdmin(async () => {
      const api = stubPlanApi(null);
      renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
      expect(await screen.findByText("No plan yet.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Plan tasks" }));
      expect((await screen.findByTestId("plan-counts")).textContent).toBe("4 tasks · 2 waves");
      expect(api.calls).toEqual([{ method: "POST", url: PLAN_URL, body: {}, auth: "Bearer adm_x" }]);
    });
  });

  it("renders waves as columns with task cards: status, nodes, footprint, dependencies, conflicts", async () => {
    stubPlanApi(SAMPLE_PLAN);
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    const board = await screen.findByRole("group", { name: "Waves" });
    const w1 = within(board).getByRole("region", { name: /^Wave 1/ });
    const w2 = within(board).getByRole("region", { name: /^Wave 2/ });
    expect(within(w1).getByRole("heading").textContent).toBe("Wave 1 · 2 tasks");
    expect(within(w1).getAllByRole("article").map((a) => a.getAttribute("data-testid"))).toEqual(["task-task.1", "task-task.2"]);
    expect(within(w1).getByRole("button", { name: "Start wave 1" })).toBeTruthy();

    const save = screen.getByTestId("task-task.4");
    expect(save.querySelector('[data-status="blocked"]')?.textContent).toBe("⊘blocked");
    expect(save.querySelector('[data-status="blocked"]')?.getAttribute("data-tone")).toBe("attention");
    expect(save.textContent).toContain("1 file · 0 entry");
    expect(within(save).getByText("depends on")).toBeTruthy();
    const conflicts = within(save).getByRole("list", { name: "Conflicts" });
    expect(conflicts.textContent).toContain("declared with Contact storage");
    expect(conflicts.textContent).toContain("file with People screen");
    expect(within(w2).getByRole("button", { name: "Start wave 2" }).hasAttribute("disabled")).toBe(true);
    expect(within(w2).getByText(/Wave 1 is not promoted yet/)).toBeTruthy();
    noGreen();
  });

  it("shows 'awaits an agent' on a claimed task", async () => {
    const claimed = { ...SAMPLE_PLAN, tasks: SAMPLE_PLAN.tasks.map((t) => (t.id === "task.1" ? { ...t, status: "claimed" as const, claim: { agentLabel: "claude:task.1", at: "", expiresAt: "" } } : t)) };
    stubPlanApi(claimed);
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    const card = await screen.findByTestId("task-task.1");
    expect(card.textContent).toContain("awaits an agent · claimed by claude:task.1");
    expect(card.querySelector('[data-status="claimed"]')?.textContent).toBe("◔claimed");
  });

  it("?task= opens TaskDetail with footprint lists, criteria, dependencies and why its wave", async () => {
    stubPlanApi(SAMPLE_PLAN);
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan&task=task.4`, undefined, seed({ api: true }));
    const detail = await screen.findByTestId("task-detail");
    expect(within(detail).getByRole("heading", { level: 3, name: "Save a contact" })).toBeTruthy();
    expect(within(detail).getByText(/Computed from the nodes' files bindings/)).toBeTruthy();
    expect(within(detail).getAllByText("public/people/add-contact-dialog.js").length).toBe(2);
    expect(within(detail).getByRole("heading", { name: "Why wave 2" })).toBeTruthy();
    expect(within(detail).getByText(/it depends on “Contact storage” \(wave 1\)/)).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Contact storage" })).toBeTruthy();
    expect(detail.querySelector("[data-verdict]")).not.toBeNull();
    noGreen();
  });

  it("rename PUTs the whole task list without footprints", async () => {
    await withAdmin(async () => {
      const api = stubPlanApi(SAMPLE_PLAN);
      renderApp(`${WORK}?evolution=${EVO1}&panel=plan&task=task.1`, undefined, seed({ api: true }));
      const title = await screen.findByLabelText("Task title");
      fireEvent.change(title, { target: { value: "Contact store" } });
      fireEvent.click(screen.getByRole("button", { name: "Save task" }));
      await waitFor(() => expect(api.calls).toHaveLength(1));
      const call = api.calls[0]!;
      expect(call).toMatchObject({ method: "PUT", url: PLAN_URL, auth: "Bearer adm_x" });
      const tasks = (call.body as { tasks: { id: string; title: string }[] }).tasks;
      expect(tasks.map((t) => t.id)).toEqual(["task.1", "task.2", "task.3", "task.4"]);
      expect(tasks[0]).toMatchObject({ title: "Contact store", origin: "user" });
      expect(tasks.every((t) => !("footprint" in t))).toBe(true);
      expect(await screen.findByRole("button", { name: "Contact store" })).toBeTruthy();
    });
  });

  it("Merge selected sends the merged list", async () => {
    const api = stubPlanApi(SAMPLE_PLAN);
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    const merge = await screen.findByRole("button", { name: /^Merge selected/ });
    expect(merge.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Select two or more tasks to merge.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Contact storage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Owner-only access" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge selected (2)" }));
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect((api.calls[0]!.body as { tasks: { id: string }[] }).tasks.map((t) => t.id)).toEqual(["task.1", "task.2", "task.4"]);
  });

  it("Re-plan asks inline first, then POSTs force", async () => {
    const api = stubPlanApi(SAMPLE_PLAN);
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Re-plan" }));
    expect(api.calls).toHaveLength(0);
    expect(screen.getByText("Re-plan replaces every task and your edits.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm re-plan" }));
    await waitFor(() => expect(api.calls).toEqual([expect.objectContaining({ method: "POST", body: { force: true } })]));
  });

  it("Start wave renders one PacketViewer per started task, copy-once, plus Copy all commands", async () => {
    const cli = (t: string) => `ARTYFACT_TOKEN=tok_${t} npx artyfact start --task ${t}`;
    const res: StartWaveResponse = {
      wave: 1,
      started: ["task.1", "task.2"].map((task, i) => ({
        task,
        systemId: SYSTEM,
        realization: realization({ id: `realization.${i + 7}` }),
        packet: { markdown: `# Task ${task}` },
        token: `tok_${task}`,
        secret: `sec_${task}`,
        remote: "https://git/fork",
        cli: cli(task),
      }) as unknown as StartWaveResponse["started"][number]),
      skipped: [],
    };
    const api = stubPlanApi(SAMPLE_PLAN, { startWave: () => json(200, res) });
    const writes: string[] = [];
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async (v: string) => void writes.push(v) } });
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Start wave 1" }));
    expect(await screen.findByRole("heading", { name: /Wave 1 started · 2 tasks/ })).toBeTruthy();
    expect(api.calls).toEqual([expect.objectContaining({ method: "POST", url: `${PLAN_URL.replace("/plan", "")}/waves/1/start` })]);
    expect(screen.getAllByRole("region", { name: "Start command" })).toHaveLength(2);
    expect(screen.getByText(cli("task.1"))).toBeTruthy();
    const first = screen.getByRole("region", { name: "Task Contact storage" });
    fireEvent.click(within(first).getByRole("button", { name: "I have copied it, hide" }));
    expect(screen.queryByText(cli("task.1"))).toBeNull();
    expect(screen.getByText(cli("task.2"))).toBeTruthy();
    // Copy-once: the hidden command is not offered again through Copy all.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy all commands" })));
    expect(writes).toEqual([cli("task.2")]);
    const second = screen.getByRole("region", { name: "Task People screen" });
    fireEvent.click(within(second).getByRole("button", { name: "I have copied it, hide" }));
    const copyAll = screen.getByRole("button", { name: "Copy all commands" });
    expect(copyAll.hasAttribute("disabled")).toBe(true);
    expect(document.getElementById(copyAll.getAttribute("aria-describedby")!)?.textContent).toBe("Every command is hidden; none is shown again.");
    noGreen();
  });

  it("says why wave start was refused", async () => {
    stubPlanApi(SAMPLE_PLAN, { startWave: () => json(409, { error: { code: "wave-blocked", message: "Wave 1 is blocked." } }) });
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Start wave 1" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Wave 1 is blocked. An earlier wave must be promoted first.");
  });

  it("a 404 other than no-plan is an error, not the empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return systems();
      if (u === PLAN_URL) return json(404, { error: { code: "not-found", message: "No evolution.1 here." } });
      return json(200, { evolutions: [], realizations: [] });
    }));
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    expect((await screen.findByRole("alert")).textContent).toBe("No evolution.1 here.");
    expect(screen.queryByText("No plan yet.")).toBeNull();
  });

  it("a blocked card says what it waits on in text", async () => {
    stubPlanApi(SAMPLE_PLAN);
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan`, undefined, seed({ api: true }));
    expect((await screen.findByTestId("task-task.4")).textContent).toContain("waits on Contact storage");
  });

  it("on fixture data: the sample plan shows read-only with the standard reason", async () => {
    renderApp(`${WORK}?evolution=${EVO1}&panel=plan&task=task.2`);
    expect((await screen.findByTestId("plan-counts")).textContent).toBe("4 tasks · 2 waves");
    expect(screen.getByText("Sample plan (fixture data, read-only).")).toBeTruthy();
    for (const name of ["Re-plan", /^Merge selected/, "Start wave 1", "Save task", "Split"]) {
      const b = screen.getByRole("button", { name });
      expect(b.hasAttribute("disabled")).toBe(true);
      expect(b.getAttribute("aria-describedby")).toBeTruthy();
    }
    expect(screen.queryByRole("checkbox", { name: /^Select / })).toBeNull();
    expect(screen.getAllByText(/Planning needs the platform API/).length).toBeGreaterThan(0);
    noGreen();
  });

  it("on fixture data, an Evolution without a sample has Plan tasks disabled with the reason", async () => {
    renderApp(`${WORK}?evolution=evolution.2&panel=plan`);
    expect(await screen.findByText("No plan yet.")).toBeTruthy();
    const b = screen.getByRole("button", { name: "Plan tasks" });
    expect(b.hasAttribute("disabled")).toBe(true);
    expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toMatch(/Planning needs the platform API/);
  });
});
