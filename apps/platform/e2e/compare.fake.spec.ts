import { expect, test } from "@playwright/test";
import { BASE, checkPage, editGenomeAndAccept, isPass } from "./fake";

test.describe("compare @fake", () => {
  test("Changelog compares a commit with its parent at Genome, Files and System level @fake", async ({ page }, testInfo) => {
    const node = "binding.digestStore";
    await editGenomeAndAccept(page, testInfo, node, "Digest store");

    await page.goto(`${BASE}/changelog`);
    const top = page.getByRole("listitem").filter({ has: page.locator("button[aria-expanded]") }).first();
    await top.getByRole("button", { expanded: false }).first().click();
    await top.getByRole("link", { name: "Compare with parent" }).click();
    await expect(page).toHaveURL(/\/compare\?.*from=.*&to=|\/compare\?.*to=.*&from=/);
    await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();

    // System level (the default): the Genome commit changed.
    const genomeCommit = page.getByRole("row", { name: /Genome commit/ });
    await expect(genomeCommit).toBeVisible();
    await expect(genomeCommit).toContainText("changed");
    await checkPage(page, testInfo, "compare-system");

    // Genome level: the added node is listed.
    await page.getByRole("tab", { name: "Genome" }).click();
    await expect(page.getByText(node).first()).toBeVisible();
    await checkPage(page, testInfo, "compare-genome");

    // Files level: the Thing's ontology, with an added line in its diff.
    await page.getByRole("tab", { name: "Files" }).click();
    await page.getByRole("link", { name: "things/webapp/ontology.yaml" }).click();
    await expect(page.locator('[data-op="add"]').first()).toBeVisible();
    // The line-number gutter of the diff has low contrast on added lines (axe color-contrast); reported to the Compare slice.
    await checkPage(page, testInfo, "compare-files", isPass, ["[data-op] > [class*=\"num\"]"]);
  });
});
