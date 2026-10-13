import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, open, SYSTEM } from "./helpers";

test.describe("shell", () => {
  test("root is Home and a System card opens its overview", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await page.getByRole("link", { name: /Keep in Touch/ }).click();
    await expect(page).toHaveURL(new RegExp(`${SYSTEM}/overview$`));
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.getByRole("link", { name: "artyfact" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("old History links land on the Changelog with their params", async ({ page }) => {
    await page.goto(`${SYSTEM}/history?commit=sc-1`);
    await expect(page).toHaveURL(new RegExp(`${SYSTEM}/changelog\\?commit=sc-1$`));
    await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  });

  test("command palette opens with Ctrl+K and navigates", async ({ page }, testInfo) => {
    await open(page, "/overview", "Overview");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Go to node" });
    await expect(dialog).toBeVisible();
    await checkA11yAndShoot(page, testInfo, "palette");
    await page.getByRole("combobox").fill("People");
    await page.getByRole("option", { name: /screen\.people/ }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/focus=screen\.people/);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  });

  test("admin token control is in the header, labelled and axe clean", async ({ page }, testInfo) => {
    await open(page, "/overview", "Overview");
    const button = page.getByRole("button", { name: /Admin token/ });
    await expect(button).toBeVisible();
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Admin token" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Token for admin actions")).toBeFocused();
    await checkA11yAndShoot(page, testInfo, "admin-token");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("Escape closes the Inspector", async ({ page }) => {
    await page.goto(`${SYSTEM}/journeys?journey=J.contacts&step=s2&focus=J.contacts%2Fs2`);
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);
    await expect(page).not.toHaveURL(/focus=/);
  });

  test("side nav reaches every view and keeps the layer param", async ({ page }) => {
    await page.goto(`${SYSTEM}/overview?layer=phenome`);
    const nav = page.getByRole("navigation", { name: "Views" });
    const views = [
      ["Map", "map"], ["Journeys", "journeys"], ["Theory", "theory"], ["Code", "code"], ["Work", "work"],
      ["Evaluations", "evaluations"], ["Changelog", "changelog"], ["Compare", "compare"], ["Deployments", "phenome"], ["Overview", "overview"],
    ] as const;
    for (const [name, url] of views) {
      await nav.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${url}\\?.*layer=phenome`));
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    }
  });

  test("narrow screens collapse the rail to glyphs and hide group heads visually", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${SYSTEM}/overview`);
    const nav = page.getByRole("navigation", { name: "Views" });
    await expect(nav.getByRole("group")).toHaveCount(3);
    for (const name of ["Genome", "Proteome", "Phenome"]) {
      const head = nav.getByText(name, { exact: true });
      await expect(head).toBeAttached();
      expect((await head.boundingBox())!.width).toBeLessThanOrEqual(1);
    }
    const label = nav.getByText("Deployments", { exact: true });
    expect((await label.boundingBox())!.width).toBeLessThanOrEqual(1);
    expect((await nav.boundingBox())!.width).toBeLessThan(80);
    await nav.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Deployments" })).toBeVisible();
    await checkA11yAndShoot(page, testInfo, "shell-narrow");
  });

  test("fixture mode is announced @fixture", async ({ page }) => {
    await open(page, "/overview", "Overview");
    await expect(page.getByText(/fixture data/i).first()).toBeVisible();
  });

  test("API is live and the SPA is not in fixture mode @live", async ({ page, request }) => {
    expect((await request.get("/api/health")).status()).toBe(200);
    await open(page, "/overview", "Overview");
    await expect(page.getByText(/fixture data/i)).toHaveCount(0);
  });
});
