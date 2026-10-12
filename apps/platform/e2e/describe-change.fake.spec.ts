import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, auth, BASE, checkPage, getJson, PACKET_PRE, startPreview, SYS, typeInEditor } from "./fake";

test.describe("describe a change @fake", () => {
  test("Evolution, work packet, editor commit, unknown build, reported preview, health assay @fake", async ({ page, request }, testInfo) => {
    const title = "Remind me of birthdays";
    // 1. Work: describe the change.
    await page.goto(`${BASE}/work`);
    await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
    await page.getByRole("button", { name: "+ Evolution" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Intent").fill("Show a birthday reminder next to each contact.");
    await page.getByLabel("Affected nodes").fill("screen.people");
    await page.getByRole("button", { name: "Add node" }).click();
    await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
    await checkPage(page, testInfo, "new-evolution");
    await page.getByRole("button", { name: "Create Evolution" }).click();
    const card = page.getByRole("group", { name: "Evolution board" }).getByRole("button", { name: new RegExp(title) });
    await expect(card).toBeVisible();

    // 2. Start work: the packet appears.
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await page.getByRole("button", { name: "Start work" }).first().click();
    await page.getByLabel("Agent label").fill("e2e-agent");
    await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
    await page.getByRole("button", { name: "Start work" }).last().click();
    await expect(page.getByRole("heading", { name: "Task Packet", exact: true })).toBeVisible();
    await expect(page.getByText("Start command")).toBeVisible();
    await checkPage(page, testInfo, "packet", undefined, [PACKET_PRE]);

    // 3. Code: an editor commit on the app. It goes to "Private contact foundation": the new Evolution has no acceptance
    // criteria (the form cannot set them), and C.webapp.health only runs for an Evolution that lists it.
    await page.goto(`${BASE}/code?repo=app&path=README.md`);
    await expect(page.getByRole("heading", { level: 1, name: "Code" })).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click();
    await typeInEditor(page, "\n\nBirthdays are shown next to each contact.\n");
    await page.getByRole("link", { name: "Commit…" }).click();
    await page.getByLabel("Message").fill("Show birthdays");
    await page.getByRole("textbox", { name: "Why" }).fill("Reminders keep friendships warm.");
    const evolution = page.getByLabel("Evolution", { exact: true });
    await evolution.selectOption(await evolution.locator("option", { hasText: "Private contact foundation" }).getAttribute("value") ?? "");
    await page.getByLabel("Your name").fill("E2E");
    await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
    await checkPage(page, testInfo, "commit-sheet");
    await page.getByRole("button", { name: "Commit", exact: true }).click();

    // 4. Work: the candidate row with its gates, build "unknown".
    await expect(page).toHaveURL(/\/work\?.*realization=/);
    const rid = new URL(page.url()).searchParams.get("realization")!;
    const row = page.getByTestId(`realization-${rid}`);
    await expect(row.getByText("build unknown")).toBeVisible();
    // The commit lands on a deep link to the realization, which opens its review.
    await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();
    await checkPage(page, testInfo, "candidate-review");

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
      await expect(row.getByText("build passed")).toBeVisible();
      await expect(row.getByText("build unknown")).toHaveCount(0);
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
