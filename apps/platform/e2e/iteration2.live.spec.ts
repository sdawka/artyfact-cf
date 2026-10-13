import { expect, test } from "@playwright/test";
import { checkPage, createEvolution, typeInEditor } from "./fake";
import { systemCard } from "./helpers";

/**
 * The describe-a-change loop against a real deployment (live mode: `ARTYFACT_E2E_LIVE=1`, `ARTYFACT_ADMIN_TOKEN` set).
 * It pushes to real Artifacts over Git, so it runs serially and skips without the admin token. Set
 * `ARTYFACT_SYSTEM_ID` for a System other than Peopling, and `ARTYFACT_CI=1` when `apps/ci` is deployed so the
 * spec also waits for the preview build to leave "unknown".
 */
const token = process.env.ARTYFACT_ADMIN_TOKEN ?? "";
const systemId = process.env.ARTYFACT_SYSTEM_ID ?? "system.peopling";
const base = `/s/${systemId}/r/head`;
const withCi = process.env.ARTYFACT_CI === "1";

test.describe.configure({ mode: "serial" });
test.skip(!token, "ARTYFACT_ADMIN_TOKEN is not set");

test.describe("iteration 2 on a live deployment", () => {
  const title = `Live check ${Date.now()}`;
  let realization = "";

  test("Home opens the Thing workspace and offers the System overview @live", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await systemCard(page, /Peopling/).first().click();
    await expect(page).toHaveURL(/\/s\/system\.peopling\/r\/head\/things\/thing\.webapp$/);
    await expect(page.getByRole("heading", { level: 1, name: "Peopling web app" })).toBeVisible();
    await page.getByRole("link", { name: "System overview", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await checkPage(page, testInfo, "live-overview");
  });

  test("an Evolution gets a packet @live", async ({ page }, testInfo) => {
    await createEvolution(page, title, "Live end-to-end check of the describe-a-change loop.", ["screen.people"], token, base);
    await page.getByRole("button", { name: "Start work" }).first().click();
    await page.getByLabel("Agent label").fill("e2e-live");
    await page.getByLabel("Admin token").fill(token);
    await page.getByRole("button", { name: "Start work" }).last().click();
    await expect(page.getByRole("heading", { name: "Task Packet", exact: true })).toBeVisible();
    await checkPage(page, testInfo, "live-packet", undefined, ['[class*="markdown"] > pre']);
  });

  test("an editor commit is pushed over Git and becomes a candidate @live", async ({ page }, testInfo) => {
    await page.goto(`${base}/code?repo=app&path=README.md`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await typeInEditor(page, `\n\nLive check ${title}.\n`);
    await page.getByRole("link", { name: "Commit…" }).click();
    await page.getByLabel("Message").fill(`Live check ${title}`);
    await page.getByRole("textbox", { name: "Why" }).fill("Exercises the real Git push.");
    const evolution = page.getByLabel("Evolution", { exact: true });
    await evolution.selectOption((await evolution.locator("option", { hasText: title }).last().getAttribute("value")) ?? "");
    await page.getByLabel("Your name").fill("E2E");
    await page.getByLabel("Admin token").fill(token);
    await page.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(page).toHaveURL(/\/work\?.*realization=/, { timeout: 60_000 });
    realization = new URL(page.url()).searchParams.get("realization") ?? "";
    expect(realization).not.toBe("");
    await expect(page.getByTestId(`realization-${realization}`)).toBeVisible();
    await checkPage(page, testInfo, "live-candidate");
  });

  test("the preview build leaves unknown once CI reports @live", async ({ page }, testInfo) => {
    test.skip(!withCi, "ARTYFACT_CI=1 is not set (apps/ci is not deployed)");
    test.setTimeout(6 * 60_000);
    await page.goto(`${base}/work?realization=${realization}`);
    const row = page.getByTestId(`realization-${realization}`);
    await expect(row.getByText("build unknown")).toHaveCount(0, { timeout: 5 * 60_000 });
    await expect(row.getByText(/build (passed|failed|error|running|queued)/)).toBeVisible();
    await checkPage(page, testInfo, "live-build");
  });
});
