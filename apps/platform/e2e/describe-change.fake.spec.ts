import { expect, test } from "@playwright/test";
import { apiCommit, auth, BASE, checkPage, getJson, PACKET_PRE, setHeaderToken, startPreview, SYS, typeInEditor } from "./fake";

test.describe("describe a change @fake", () => {
  test("Genome work, local Task handoff, historical candidate preview and health assay @fake", async ({ page, request }, testInfo) => {
    const title = "Remind me of birthdays";
    // 1. Work: describe the change. Writes use the header's admin token.
    await setHeaderToken(page);
    await page.goto(`${BASE}/work`);
    await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
    await page.getByRole("button", { name: "Evolution", exact: true }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Intent").fill("Show a birthday reminder next to each contact.");
    await page.getByLabel("Affected nodes").fill("screen.people");
    await page.getByRole("button", { name: "Add node" }).click();
    await checkPage(page, testInfo, "new-evolution");
    await page.getByRole("button", { name: "Create Evolution" }).click();
    // The new Evolution is selected: its row is current in the list and its detail is open.
    const row = page.getByRole("region", { name: "Plans and Evolutions" }).getByRole("link", { name: new RegExp(`^${title}`) });
    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${title}`) })).toBeVisible();

    // 2. Start work (the detail's primary on an actionable Evolution) replaces the attempts; the packet appears.
    await page.getByRole("button", { name: "Start work" }).first().click();
    await expect(page.getByRole("button", { name: "Back to Evolution" })).toBeVisible();
    await page.getByLabel("Agent label").fill("e2e-agent");
    await page.getByRole("button", { name: "Start work" }).last().click();
    await expect(page.getByRole("heading", { name: "Task Packet", exact: true })).toBeVisible();
    await expect(page.getByText("Start command")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy command" })).toHaveAttribute("data-variant", "primary");
    await checkPage(page, testInfo, "packet", undefined, [PACKET_PRE]);

    // 3. App drafts stay local; implementation hands off to an isolated Realization Task.
    await page.goto(`${BASE}/code?repo=app&path=README.md`);
    await expect(page.getByRole("heading", { level: 1, name: "Code" })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await typeInEditor(page, "\n\nBirthdays are shown next to each contact.\n");
    await page.getByRole("link", { name: "Commit…" }).click();
    await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Create a Realization Task" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("artyfact.draft.system.peopling.app.head"))).toContain("Birthdays are shown next to each contact.");
    await checkPage(page, testInfo, "local-task-handoff");

    // Keep the historical build/health regression meaningful using the already-seeded legacy Evolution.
    // New app implementation goes through Tasks; this request exercises the supported historical API only.
    const legacy = await apiCommit(request, "evolution.1", "app", "legacy:e2e", [{ path: "README.md", content: `Historical preview smoke ${Date.now()}\n` }]);
    const rid = legacy.realization;
    await page.goto(`${BASE}/work?evolution=evolution.1`);

    // 4. Work: the attempt row with build "unknown" and its hand-off to Review.
    const attempt = page.getByTestId(`realization-${rid}`);
    await expect(attempt.getByText("build unknown")).toBeVisible();
    await checkPage(page, testInfo, "evolution-attempts");
    // A Work deep link to the realization opens its review on Review.
    await page.goto(`${BASE}/work?evolution=evolution.1&realization=${encodeURIComponent(rid)}`);
    await expect(page).toHaveURL(/\/review\?.*realization=/);
    await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();
    await checkPage(page, testInfo, "candidate-review");
    await page.goto(`${BASE}/work?evolution=evolution.1`);
    const row2 = page.getByTestId(`realization-${rid}`);

    // 5. A reported preview: the build leaves "unknown" and the health assay runs.
    const preview = await startPreview();
    try {
      const { candidates } = await getJson<{ candidates: { realization: string; commit: string }[] }>(request, "/candidates");
      const commit = candidates.find((c) => c.realization === rid)!.commit;
      preview.setBuildId(commit);
      const res = await request.post(`/api/systems/${SYS}/realizations/${rid}/builds`, {
        headers: auth,
        data: { status: "passed", kind: "preview", commit, url: preview.url, buildId: commit },
      });
      expect(res.ok(), await res.text()).toBe(true);
      await expect(row2.getByText("build passed")).toBeVisible();
      await expect(row2.getByText("build unknown")).toHaveCount(0);
      await page.goto(`${BASE}/evaluations`);
      await expect(page.getByRole("heading", { level: 1, name: "Evaluations" })).toBeVisible();
      const health = page.getByRole("row", { name: /C\.webapp\.health/ }).first();
      await expect(health).toBeVisible();
      await expect(health).toContainText("pass");
      await checkPage(page, testInfo, "evaluations");
    } finally {
      await preview.close();
    }
  });
});
