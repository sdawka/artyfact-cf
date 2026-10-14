import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, successToneElements, systemCard } from "./helpers";

test.describe("home on the fake platform", () => {
  test("the wordmark opens Home and the single-Thing System card opens its environment atlas @fake", async ({ page }, testInfo) => {
    await page.goto("/s/system.peopling/r/head/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "artyfact" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await expect(page.getByText("fixture data")).toHaveCount(0);
    const card = systemCard(page, /Peopling/);
    await expect(card.getByText("Phase: unrealized")).toBeVisible();
    await expect(card.getByText("not built")).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "home-fake");
    await card.click();
    await expect(page).toHaveURL(/\/s\/system\.peopling\/r\/head\/map\?scope=environment$/);
    await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
    await expect(page.locator('[data-map-node="system.peopling"]')).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "environment-fake");
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page).toHaveURL(/\/s\/system\.peopling\/r\/head\/overview\?scope=environment$/);
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "overview-fake");
  });
});
