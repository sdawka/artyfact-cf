import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, apiCommit, apiEvolution, auth, BASE, checkPage, getJson, isPass, SYS } from "./fake";

/**
 * Review's agreement trees: a Genome amendment's changes (built client-side from its semantic delta) and the import
 * review of a freshly imported System. The import test re-imports the shared System with a review, so it runs in its own
 * project (`fake-import`) after every other flow.
 */
test.describe("Review: agreement trees @fake", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);
  });

  test("an amendment's changes as a tree: '1 add' under its section, agree at the Thing, accept @fake", async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    const run = Date.now().toString(36);
    const node = `binding.tree${run}`;
    const evo = await apiEvolution(request, `Tree review ${run}`, "genome-amendment", ["section.runtime"]);
    const { realization } = await apiCommit(request, evo, "genome", "agent-tree", [{
      path: `thing.webapp/section.runtime/${node}/node.yaml`,
      content: `id: ${node}\nkind: binding\nfields:\n  name: ${node}\n  description: ${node} for the tree e2e\n`,
    }]);

    await page.goto(`${BASE}/review?evolution=${evo}&realization=${realization}`);
    const review = page.getByRole("region", { name: `Review ${realization}` });
    const tree = page.getByRole("tree", { name: "Amendment changes" });
    await expect(async () => {
      await review.getByRole("tab", { name: "Amendment" }).click();
      await expect(tree).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Semantic delta" })).toHaveCount(0);
    const section = tree.locator('[role="treeitem"][data-node-id="section.runtime"]');
    await expect(section.locator(":scope > div").first()).toContainText("1 add");
    const thing = tree.locator('[role="treeitem"][data-node-id="thing.webapp"]');
    await thing.locator(":scope > div").first().getByRole("button", { name: /^Agree / }).click();
    await expect(section).toHaveAttribute("data-decision", "agree");
    await checkPage(page, testInfo, "review-amendment-tree", (h) => isPass(h) || /classRow|_num_|deliberate non-standard choice/.test(h));

    await page.getByRole("textbox", { name: "Accepted interpretation" }).fill("The binding is part of the runtime.");
    await page.getByRole("button", { name: "Accept amendment" }).click();
    await expect(page.getByText(/Accepted\. New Genome commit/)).toBeVisible();
  });

  // TODO: drop the fixme once W9 (import-review routes, `ImportSystemRequest.review`) is merged on this branch. It passes
  // against w9-import-review merged on top of this branch.
  test.fixme("import review: Home row, Review 'Import' row, reject a file-less node, accept with an interpretation @fake @import", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    // A forced re-import of unchanged repos keeps the head (no new System commit, so no review): delete the System and
    // import it again from its repos, which leaves the review pending.
    const deleted = await request.delete(`/api/systems/${SYS}`, { headers: auth });
    expect(deleted.ok(), await deleted.text()).toBe(true);
    const imported = await request.post("/api/systems/import", { headers: auth, data: { systemId: SYS, force: true, review: true } });
    expect(imported.ok(), await imported.text()).toBe(true);

    await page.goto("/");
    await expect(page.getByRole("link", { name: /import awaits review/ })).toBeVisible();

    await page.goto(`${BASE}/review`);
    const queue = page.getByRole("region", { name: /Waiting on you/ });
    const row = queue.getByTestId("queue-import");
    await expect(row).toContainText(/Import · \d+ nodes/);
    await row.click();
    await expect(page).toHaveURL(/\/review\?panel=import$/);
    const panel = page.getByRole("article", { name: "Import review" });
    const tree = panel.getByRole("tree", { name: "Imported Genome" });
    await expect(tree).toBeVisible();
    const accept = panel.getByRole("button", { name: /^Accept import/ });
    await expect(accept).toBeDisabled();

    // Agree every top-level node (its subtree inherits), then reject section.externals, a section with no files binding.
    const head = (id: string) => tree.locator(`[role="treeitem"][data-node-id="${id}"] > div`).first();
    const roots = await tree.locator(':scope > [role="treeitem"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.nodeId!));
    for (const id of roots) await head(id).getByRole("button", { name: /^Agree / }).click();
    await head("section.externals").getByRole("button", { name: /^Reject / }).click();
    await expect(tree.locator('[role="treeitem"][data-node-id="section.externals"]')).toHaveAttribute("data-decision", "reject");
    await expect(panel.getByTestId("import-summary")).not.toContainText("undecided");
    await panel.getByRole("textbox", { name: "Accepted interpretation" }).fill("Peopling as imported, without the externals section.");
    await checkPage(page, testInfo, "review-import");
    await panel.getByRole("button", { name: "Accept import, remove 1 rejected" }).click();
    await expect(panel.getByText(/1 rejected node will be removed by an amendment that awaits an admin/)).toBeVisible();

    const after = await getJson<{ status: string; rejectedNodes?: string[] }>(request, "/import-review");
    expect(after.status).toBe("accepted");
    expect(after.rejectedNodes).toEqual(["section.externals"]);
    const board = await getJson<{ realizations: { status: string; target: string }[] }>(request, "/evolutions");
    expect(board.realizations.some((r) => r.status === "awaiting-admin" && r.target === "genome")).toBe(true);
    await expect(queue.getByTestId("queue-import")).toHaveCount(0);
  });
});
