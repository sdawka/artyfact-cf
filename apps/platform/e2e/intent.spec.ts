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
    await expect(panel.getByRole("table", { name: "op.1 fields" })).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: /op\.3/ })).toBeChecked();
    await expect(panel.getByRole("button", { name: "Accept selected" })).toBeDisabled();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "intent-sample");
  });
});
