import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Task } from "../shared/lifecycle";
import { ADMIN_TOKEN, apiPlan, BASE, checkPage, cli, SYS } from "./fake";

/**
 * Draft → edit → create a RealizationPlan in the UI, then two agents claim and submit wave 1 through the CLI over fake git,
 * the later task is refused until both are selected, and the plan is selected, integrated, reviewed and promoted in the UI.
 */
test.describe("realization plan from draft to promotion @fake", () => {
  // Needs the planner draft route (P2), the lifecycle packet and modes (P3), the CLI token at rest (P6) and the fake git
  // server (P1) on one branch. P10 flips this to `test` after merging them, and picks draft nodes from P8's Genome that
  // give a plan whose wave 2 task depends on two wave 1 tasks.
  test.fixme(true, "P10: needs P1 fake git, P2 draft route, P3 lifecycle packet and P6 token at rest merged");

  test("draft, edit, create, claim, refuse, submit, select, integrate, review and promote @fake", async ({ page, request, baseURL }, testInfo) => {
    testInfo.setTimeout(180_000);
    const work = mkdtempSync(join(tmpdir(), "artyfact-plan-"));
    const run = (args: string[], cwd = work) => cli(args, { cwd, baseURL: baseURL! });
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);

    // Draft and edit in the UI. Nothing is stored until Create plan.
    await page.goto(`${BASE}/work?panel=plan`);
    await page.getByLabel("Genome nodes to implement").fill(["binding.contactsStore", "screen.people", "component.TodayList"].join("\n"));
    await expect(page.getByRole("button", { name: "Draft tasks" })).toBeEnabled();
    await page.getByRole("button", { name: "Draft tasks" }).click();
    await expect(page.getByTestId("draft-waves")).toHaveText(/^As drafted: wave 1/);
    await checkPage(page, testInfo, "plan-draft");
    const firstTitle = page.getByLabel(/^Title of /).first();
    await firstTitle.fill(`${await firstTitle.inputValue()} (edited)`);
    await expect(page.getByTestId("draft-waves")).toHaveText("Edited: waves are recomputed when the plan is created.");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page).toHaveURL(/[?&]plan=/);
    const planId = new URL(page.url()).searchParams.get("plan")!;
    let plan = await apiPlan(request, planId);
    expect(plan.tasks[0]!.title).toMatch(/\(edited\)$/);

    // The board mirrors analysis.waves; wave 2's task waits on its wave 1 dependencies.
    const board = page.getByRole("group", { name: "Waves" });
    await expect(board.getByRole("region", { name: /^Wave \d/ })).toHaveCount(plan.analysis.waves.length);
    const t3 = plan.tasks.find((t) => (plan.analysis.waves[1] ?? []).includes(t.id) && t.dependsOn.length >= 2)!;
    expect(t3, "a wave 2 task depending on two wave 1 tasks").toBeTruthy();
    const deps = t3.dependsOn.map((id) => plan.tasks.find((t) => t.id === id)!);
    for (const t of deps) await expect(page.getByRole("listitem", { name: `Command for ${t.title}` })).toContainText(`task claim ${planId} ${t.id}`);
    await checkPage(page, testInfo, "plan-board");

    // Two agents claim and submit wave 1 through the CLI; t3 is refused until both are selected.
    const submitted: Record<string, string> = {};
    for (const t of deps) {
      const claimed = await run(["task", "claim", planId, t.id, "--system", SYS, "--dir", t.id, "--agent-label", `agent ${t.id}`]);
      expect(claimed.code, claimed.stderr).toBe(0);
    }
    const early = await run(["task", "claim", planId, t3.id, "--system", SYS, "--dir", t3.id]);
    expect(early.code).not.toBe(0);
    expect(early.stderr).toMatch(/dependency .* is not selected/);
    for (const t of deps) submitted[t.id] = await implementAndSubmit(t, join(work, t.id), run);

    plan = await apiPlan(request, planId);
    for (const t of deps) {
      await selectInUi(page, t, submitted[t.id]!);
      await expect(page.getByTestId(`task-${t.id}`).locator('[data-status="selected"]')).toBeVisible({ timeout: 15_000 });
    }
    await checkPage(page, testInfo, "plan-selected");

    // Every remaining task now claims, submits and is selected, wave by wave.
    for (const ids of plan.analysis.waves) for (const id of ids) {
      if (submitted[id]) continue;
      const t = (await apiPlan(request, planId)).tasks.find((x) => x.id === id)!;
      const claimed = await run(["task", "claim", planId, t.id, "--system", SYS, "--dir", t.id]);
      expect(claimed.code, claimed.stderr).toBe(0);
      submitted[t.id] = await implementAndSubmit(t, join(work, t.id), run);
      await selectInUi(page, t, submitted[t.id]!);
    }

    // Integrate, review the combined change, promote.
    await page.getByRole("button", { name: "Integrate selected Task results" }).click();
    await expect(page.getByRole("heading", { name: "Combined implementation review" })).toBeVisible({ timeout: 30_000 });
    await checkPage(page, testInfo, "plan-review");
    await page.getByLabel("Promotion rationale").fill("Reviewed every changed binding in the e2e run.");
    await page.getByRole("button", { name: "Promote reviewed implementation" }).click();
    await expect.poll(async () => (await apiPlan(request, planId)).status, { timeout: 30_000 }).toBe("promoted");
    await checkPage(page, testInfo, "plan-promoted");
  });
});

/** Writes one file inside the task's footprint, commits it and submits with the token stored at claim. Returns the candidate id. */
async function implementAndSubmit(t: Task, dir: string, run: (args: string[], cwd?: string) => Promise<{ code: number; stdout: string; stderr: string }>): Promise<string> {
  const path = t.footprint.paths[0] ?? t.footprint.globs[0]!.replace(/\*\*.*$/, "").replace(/\/?$/, "/e2e.txt");
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), `// ${t.id}: e2e change\n`, { flag: "a" });
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "commit", "-m", `e2e ${t.id}`]);
  const res = await run(["task", "submit", "--json"], dir);
  expect(res.code, res.stderr).toBe(0);
  return (JSON.parse(res.stdout) as { candidate: { id: string } }).candidate.id;
}

/** Opens the task on the board and selects its reviewed candidate. */
async function selectInUi(page: Page, t: Pick<Task, "id" | "title">, candidateId: string) {
  await page.getByTestId(`task-${t.id}`).getByRole("button", { name: t.title }).click();
  const detail = page.getByTestId("task-detail");
  await expect(detail.getByRole("heading", { name: t.title })).toBeVisible();
  await detail.getByLabel(`Reviewed candidate ID for ${t.title}`).fill(candidateId);
  await detail.getByRole("button", { name: "Select reviewed Task result" }).click();
}
