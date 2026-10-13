import { expect, test } from "@playwright/test";
import { BASE, checkPage, editGenomeAndAccept } from "./fake";
import { systemCard } from "./helpers";

test.describe("edit and realize @fake", () => {
  test("Inspector to Code, commit, accept, Changelog and Home show the new head @fake", async ({ page }, testInfo) => {
    await page.goto("/");
    const before = await systemCard(page, /Peopling/).textContent();

    await editGenomeAndAccept(page, testInfo, "binding.birthdayStore", "Birthday store");

    await page.goto(`${BASE}/changelog`);
    await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
    const top = page.getByRole("listitem").filter({ has: page.locator('button[aria-expanded]') }).first();
    await expect(top).toContainText(/sc-\d+/);
    // An accepted Genome change adds a node and touches no app file.
    await expect(top).toContainText("nodes +1");
    await top.getByRole("button", { expanded: false }).first().click();
    await expect(top.getByText("binding.birthdayStore").first()).toBeVisible();
    await checkPage(page, testInfo, "changelog");
    const commitId = (await top.locator("code").first().textContent()) ?? "";
    await top.getByRole("link", { name: "Open this revision in the Map" }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${commitId}[^/]*/map`));
    await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
    await checkPage(page, testInfo, "map-at-commit");

    await page.goto("/");
    const card = systemCard(page, /Peopling/);
    await expect(card).not.toHaveText(before ?? "");
    await expect(card.getByText(/sc-[2-9]/)).toBeVisible();
    await checkPage(page, testInfo, "home-after");
  });
});
