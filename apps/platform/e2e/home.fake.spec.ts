import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, successToneElements } from "./helpers";

test.describe("home on the fake platform", () => {
  test("the wordmark opens Home and the single-Thing System card opens its Thing workspace @fake", async ({ page }, testInfo) => {
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
    await expect(page).toHaveURL(/\/s\/system\.keep-in-touch\/r\/head\/things\/thing\.webapp$/);
    await expect(page.getByRole("heading", { level: 1, name: "Keep in Touch web app" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Thing workspace breadcrumb" })).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "thing-fake");
    await page.getByRole("link", { name: "System overview", exact: true }).click();
    await expect(page).toHaveURL(/\/s\/system\.keep-in-touch\/r\/head\/overview$/);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "overview-fake");
  });
});
