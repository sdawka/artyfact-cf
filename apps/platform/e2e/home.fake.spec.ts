import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, successToneElements } from "./helpers";

test.describe("home on the fake platform", () => {
  test("the wordmark opens Home and the Keep in Touch card opens its overview @fake", async ({ page }, testInfo) => {
    await page.goto("/s/system.keep-in-touch/r/head/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "artyfact" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await expect(page.getByText("fixture data")).toHaveCount(0);
    const card = page.getByRole("link", { name: /Keep in Touch/ });
    await expect(card.getByText("Phase: unrealized")).toBeVisible();
    await expect(card.locator('[data-status="not-fully-built"]')).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "home-fake");
    await card.click();
    await expect(page).toHaveURL(/\/s\/system\.keep-in-touch\/r\/head\/overview$/);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "overview-fake");
  });
});
