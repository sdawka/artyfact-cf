import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, open, successToneElements } from "./helpers";

test.describe("describe a change", () => {
  test("fixture: the intent panel shows the sample proposal read-only, axe clean, no success tone @fixture", async ({ page }, testInfo) => {
    await open(page, "/work?panel=intent&anchor=screen.people", "Work");
    const panel = page.getByRole("region", { name: "Describe a change" });
    await expect(panel.getByText("Sample proposal (fixture data, read-only)")).toBeVisible();
    await expect(panel.getByText("Starting from")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Propose changes" })).toBeDisabled();
    await expect(panel.getByRole("heading", { name: "Routed path" })).toBeVisible();
    await expect(panel.getByText("provider fake")).toBeVisible();
    await panel.locator("summary", { hasText: "Show before and after op.1" }).click();
    await expect(panel.getByRole("table", { name: "op.1 fields" })).toBeVisible();
    // The agreement tree is read-only: decisions disabled, rows still there.
    await expect(panel.getByRole("treeitem", { name: /^Birthday field,/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Agree Peopling web app" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Accept agreed" })).toBeDisabled();
    // Back to Work, top-left of the panel; the header's Describe a change is secondary and pressed while it is open.
    await expect(panel.getByRole("button", { name: "Back to Work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Describe a change", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "intent-sample");
  });
});
