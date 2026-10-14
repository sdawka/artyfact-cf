import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, successToneElements, systemCard } from "./helpers";
import { mockApi } from "./mockApi";

test.describe("home", () => {
  test("lists the fixture System, is axe clean and never green @fixture", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await expect(systemCard(page, /Peopling/)).toBeVisible();
    await expect(page.getByText("fixture data")).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "home-fixture");
  });

  test("narrow screens keep one column and reachable cards @fixture", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const card = systemCard(page, /Peopling/);
    await card.focus();
    await expect(card).toBeFocused();
    await checkA11yAndShoot(page, testInfo, "home-narrow");
  });
});

test.describe("home with a populated API", () => {
  test("two Systems show distinct states; only a passed build is green @fixture", async ({ page }, testInfo) => {
    await mockApi(page);
    await page.goto("/");
    const peopling = systemCard(page, /Peopling/);
    const notes = systemCard(page, /Field Notes/);
    await expect(peopling).toHaveAttribute("data-state", "evolving");
    await expect(notes).toHaveAttribute("data-state", "attention");
    await expect(page.getByText("fixture data")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Reusable Parts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Button system" })).toHaveAttribute("href", "/parts/part.ui.buttons/2.1.0");
    await expect(notes.getByText("not deployed, unknown")).toBeVisible();
    await expect(peopling.locator('[data-status="deployed"]')).toHaveText(/deployed/);
    const green = await successToneElements(page);
    expect(green.length).toBeGreaterThan(0);
    expect(green.every((h) => h.includes("build passed"))).toBe(true);
    await checkA11yAndShoot(page, testInfo, "home-populated");
    await peopling.click();
    await expect(page).toHaveURL(/\/s\/system\.peopling\/r\/head\/map\?scope=environment$/);
    await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
    await expect(page.locator('[data-map-node="system.peopling"]')).toBeVisible();
  });

  test("the Needs you ledger names what awaits review, and Go to… opens a palette @fixture", async ({ page }, testInfo) => {
    await mockApi(page);
    await page.goto("/");
    const ledger = page.getByRole("region", { name: "Needs you" });
    await expect(ledger.getByRole("link", { name: "Field Notes" })).toHaveAttribute("href", "/s/system.field-notes/r/head/review");
    await expect(ledger).toContainText("Field Notes · 1 awaits your review");
    await expect(ledger.getByRole("link", { name: "Peopling" })).toHaveCount(0);
    await expect(systemCard(page, /Field Notes/)).toBeVisible();
    await page.getByRole("button", { name: /Go to…/ }).click();
    await expect(page.getByRole("option", { name: /Peopling/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Button system/ })).toBeVisible();
    const palette = page.getByRole("dialog", { name: "Go to", exact: true });
    await expect.poll(() => palette.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === "running"))).toBe(false);
    await checkA11yAndShoot(page, testInfo, "home-palette");
    await page.keyboard.press("Escape");
    // Radix retains the fading content until its close animation finishes.
    await expect(palette).toBeHidden();
    await checkA11yAndShoot(page, testInfo, "home-ledger");
  });

  test("mockApi refuses unmocked writes with 405 @fixture", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const status = await page.evaluate(async () => (await fetch("/api/systems/system.peopling/evolutions", { method: "POST", body: "{}" })).status);
    expect(status).toBe(405);
  });
});
