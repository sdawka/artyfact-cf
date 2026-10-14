import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { checkA11yAndShoot, open, SYSTEM } from "./helpers";

/** Viewport screenshot into e2e-artifacts/ (git-ignored), for review. */
const shoot = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

test.describe("platform hero moments", () => {
  test("overview hero: data-driven content surface, labelled values, hover-only meters, pulse on artyfact:fx", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, "/overview", "Peopling");
    const hero = page.getByRole("region", { name: "System light" });
    await expect(page.getByRole("heading", { level: 1, name: "Peopling" })).toBeVisible();
    await expect(hero.getByText("Readiness", { exact: true })).toBeVisible();
    await expect(hero.getByText(/^\d+%$/)).toBeVisible();
    const surface = hero.locator('[data-effect="surface"]');
    await expect(surface).toHaveAttribute("data-effect-mode", /^(css|static)$/);
    await expect(page.locator('[data-effect="orb"]')).toHaveCount(0);

    // Content geometry is independent of the light controller: no layout shift.
    const before = await hero.boundingBox();
    await page.waitForTimeout(500);
    expect(await hero.boundingBox()).toEqual(before);

    const readiness = page.getByRole("region", { name: "Model readiness" });
    // The meter is not a tab stop (its title is the link); hovering it sparks the light.
    await expect(readiness).not.toHaveAttribute("tabindex", /.*/);
    await readiness.hover();
    const spark = hero.locator('[data-surface-spark]');
    const sparkBox = await spark.boundingBox();
    const surfaceBox = await surface.boundingBox();
    expect(sparkBox && surfaceBox && sparkBox.y < surfaceBox.y + surfaceBox.height).toBe(true);
    await checkA11yAndShoot(page, testInfo, "overview-hero");
    await page.waitForTimeout(2400); // let the intro finish
    await shoot(page, testInfo, "overview-hero");

    await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Implementation conformance"]')!.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent("artyfact:fx", { detail: { kind: "promoted", strength: 1.6, x: el.left + el.width / 2, y: el.top } }));
    });
    await page.waitForTimeout(120);
    await shoot(page, testInfo, "overview-promote-pulse");
    expect(errors).toEqual([]);
  });

  test("model loader is a glowing content frame with a text status @fixture", async ({ page }, testInfo) => {
    // Hold the API (fixture mode falls back after it answers) so the loader stays up.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${SYSTEM}/overview`);
    const status = page.getByRole("status").filter({ hasText: "Loading model…" });
    await expect(status).toBeVisible();
    await expect(status.locator('[data-effect="surface"]')).toHaveCount(1);
    await page.waitForTimeout(1200);
    await shoot(page, testInfo, "model-loader");
    release();
    await expect(page.getByRole("heading", { level: 1, name: "Peopling" })).toBeVisible();
  });
});
