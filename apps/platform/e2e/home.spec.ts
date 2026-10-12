import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, successToneElements } from "./helpers";

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
