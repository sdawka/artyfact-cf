import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, successToneElements } from "./helpers";
import { mockApi } from "./mockApi";

test.describe("home", () => {
  test("lists the fixture System, is axe clean and never green @fixture", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Keep in Touch/ })).toBeVisible();
    await expect(page.getByText("fixture data")).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "home-fixture");
  });

  test("narrow screens keep one column and reachable cards @fixture", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const card = page.getByRole("link", { name: /Keep in Touch/ });
    await card.focus();
    await expect(card).toBeFocused();
    await checkA11yAndShoot(page, testInfo, "home-narrow");
  });
});

test.describe("home with a populated API", () => {
  test("two Systems show distinct states; only a passed build is green @fixture", async ({ page }, testInfo) => {
    await mockApi(page);
    await page.goto("/");
    const kit = page.getByRole("link", { name: /Keep in Touch/ });
    const notes = page.getByRole("link", { name: /Field Notes/ });
    await expect(kit).toHaveAttribute("data-state", "evolving");
    await expect(notes).toHaveAttribute("data-state", "attention");
    await expect(page.getByText("fixture data")).toHaveCount(0);
    await expect(notes.getByText("not deployed, unknown")).toBeVisible();
    await expect(kit.locator('[data-status="deployed"]')).toHaveText(/deployed/);
    const green = await successToneElements(page);
    expect(green.length).toBeGreaterThan(0);
    expect(green.every((h) => h.includes("build passed"))).toBe(true);
    await checkA11yAndShoot(page, testInfo, "home-populated");
    await kit.click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });

  test("mockApi refuses unmocked writes with 405 @fixture", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const status = await page.evaluate(async () => (await fetch("/api/systems/system.keep-in-touch/evolutions", { method: "POST", body: "{}" })).status);
    expect(status).toBe(405);
  });
});
