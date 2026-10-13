import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, apiEvolution, apiPlan, auth, BASE, checkPage, PACKET_PRE, SYS } from "./fake";

test.describe("plan an Evolution into Tasks and start a wave @fake", () => {
  // TODO(integration): the plan (W4) and start-wave (W5) routes are not on this branch yet; flip to `test` once they merge.
  test.fixme("Plan → Plan tasks → wave columns → Start wave 1 → commands → claimed → checkpoint → realizing @fake", async ({ page, request }, testInfo) => {
    testInfo.setTimeout(60_000);
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);
    // Two Peopling nodes whose files bindings share nothing: migrations/** and public/people/**.
    const eid = await apiEvolution(request, "Plan two disjoint nodes", "implementation", ["binding.contactsStore", "screen.people"]);

    await page.goto(`${BASE}/work?evolution=${eid}`);
    await expect(page.getByRole("heading", { level: 2, name: "Plan two disjoint nodes" })).toBeVisible();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByText("No plan yet.")).toBeVisible();
    await checkPage(page, testInfo, "plan-empty");
    await page.getByRole("button", { name: "Plan tasks" }).click();

    // The board mirrors the server's plan: one column per wave, one card per task.
    await expect(page.getByTestId("plan-counts")).toHaveText(/^\d+ tasks? · \d+ waves?$/);
    const plan = await apiPlan(request, eid);
    expect(plan.tasks.length).toBeGreaterThan(0);
    const wave1 = plan.waves[0]!;
    const board = page.getByRole("group", { name: "Waves" });
    await expect(board.getByRole("region", { name: /^Wave \d/ })).toHaveCount(plan.waves.length);
    const col1 = board.getByRole("region", { name: /^Wave 1/ });
    await expect(col1.getByRole("article")).toHaveCount(wave1.length);
    await checkPage(page, testInfo, "plan-waves");

    await col1.getByRole("button", { name: "Start wave 1" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Wave 1 started · ${wave1.length} tasks?`) })).toBeVisible();
    await expect(page.getByRole("region", { name: "Start command" })).toHaveCount(wave1.length);
    await expect(page.getByRole("button", { name: "Copy all commands" })).toBeVisible();
    for (const id of wave1) {
      const card = page.getByTestId(`task-${id}`);
      await expect(card.locator('[data-status="claimed"]')).toBeVisible();
      await expect(card.getByText(/awaits an agent/)).toBeVisible();
    }
    await checkPage(page, testInfo, "plan-wave-started", undefined, [PACKET_PRE]);

    // An agent's first checkpoint moves its task to realizing; the card follows without a reload.
    const first = (await apiPlan(request, eid)).tasks.find((t) => t.id === wave1[0])!;
    expect(first.realizationId, "a claimed task has its realization").toBeTruthy();
    const res = await request.post(`/api/systems/${SYS}/evolutions/${eid}/realizations/${first.realizationId}/checkpoints`, { headers: auth, data: { message: "e2e: first checkpoint" } });
    expect(res.ok(), await res.text()).toBe(true);
    await expect(page.getByTestId(`task-${first.id}`).locator('[data-status="realizing"]')).toBeVisible({ timeout: 15_000 });
    await checkPage(page, testInfo, "plan-realizing", undefined, [PACKET_PRE]);
  });
});
