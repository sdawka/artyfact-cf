import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TOKEN, checkPage, sweepViews } from "./fake";
import { systemCard } from "./helpers";

/** Artyfact describing itself: the platform here is seeded with the repo-root `genome/` (`FAKE_SEED=artyfact`). */
const SYS = "system.artyfact";
const BASE = `/s/${SYS}/r/head`;
/** The on-demand containment tree lists every real Thing. */
async function expectTenThings(page: Page) {
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Containment" });
  for (const t of THINGS) await expect(tree.locator(`#map-tree-${t.replace(".", "_")}`)).toHaveAttribute("role", "treeitem");
  await expect(tree.getByRole("treeitem", { name: /, Thing$/ })).toHaveCount(THINGS.length);
}

const THINGS = ["ci", "cli", "effects", "model", "ontology", "platform", "rules", "semantic", "site", "templates"].map((t) => `thing.${t}`);

test.describe("the self-model @fake", () => {
  test("Home shows Artyfact with its ten Things @fake", async ({ page, request }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await expect(systemCard(page, /Artyfact/)).toBeVisible();
    await expect(page.getByText("fixture data")).toHaveCount(0);
    await checkPage(page, testInfo, "self-home");
    // Home shows no Thing list; the card opens the System, whose Map tree lists all ten.
    await systemCard(page, /Artyfact/).click();
    await expect(page).toHaveURL(/\/s\/system\.artyfact/);
    await expect(page.getByRole("heading", { name: "Map", level: 1 })).toBeVisible();
    await expect(page.locator(`[data-map-node="${SYS}"]`)).toBeVisible();
    await expectTenThings(page);
    const model = await (await request.get(`/api/systems/${SYS}/model`)).json() as { model: { system: { things: string[] } } };
    expect(model.model.system.things).toEqual(THINGS);
  });

  test("the Map preserves Things and immediate children while Inspector fields follow view hints @fake", async ({ page, request }, testInfo) => {
    const { model } = await (await request.get(`/api/systems/${SYS}/model`)).json() as { model: { nodes: { id: string; parent: string; kind: string }[] } };
    await page.goto(`${BASE}/map?scope=${SYS}`);
    const drawnThings = page.locator('[data-map-node][data-role="child"][data-map-node^="thing."]');
    await expect(drawnThings).toHaveCount(THINGS.length);
    expect(await drawnThings.evaluateAll((els) => els.map((e) => e.getAttribute("data-map-node")!).sort())).toEqual([...THINGS].sort());
    await expectTenThings(page);
    await page.getByRole("button", { name: "Close map navigation" }).click();
    await page.goto(`${BASE}/map?scope=thing.platform`);
    const children = model.nodes.filter((node) => node.parent === "thing.platform").map((node) => node.id);
    const tiles = page.locator('[data-map-node][data-role="child"]');
    await expect(tiles).toHaveCount(children.length);
    expect(await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-map-node")!).sort())).toEqual(children.sort());
    await expect(page.locator("[data-map-band]")).toHaveCount(0);
    // All kinds remain discoverable even when their template layers are not tiles.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByText("Kinds", { exact: true }).click();
    await expect(page.getByRole("group", { name: "Kinds shown" }).getByRole("checkbox", { name: /Endpoint/ })).toBeVisible();
    await checkPage(page, testInfo, "self-map-containment");

    // A worker-service endpoint: Route, Auth, Request, Response in the template's field order.
    await page.goto(`${BASE}/map?focus=endpoint.apply-template-upgrade&inspect=1`);
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector.getByText("Route", { exact: true })).toBeVisible();
    await expect(inspector.locator("dt, [data-field-label]").filter({ hasText: /^(Route|Auth|Request|Response)$/ })).toHaveText(["Route", "Auth", "Request", "Response"]);
    await expect(inspector.getByText("POST /api/systems/:id/template-upgrade")).toBeVisible();
    await checkPage(page, testInfo, "self-inspector-hints");
  });

  test("every view renders for Artyfact without console errors @fake", async ({ page }, testInfo) => {
    await sweepViews(page, testInfo, BASE, "self");
  });

  test("an intent about the platform lands under thing.platform; Compare shows the change at that depth @fake", async ({ page, request }, testInfo) => {
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);
    await page.goto(`${BASE}/work?panel=intent`);
    const message = `add rate limiting to the intents endpoint ${Date.now().toString(36)}`;
    await page.getByLabel("What should change?").fill(message);
    await page.getByRole("button", { name: "Propose changes" }).click();
    await expect(page.getByText("provider fake")).toBeVisible();
    await expect(page.getByRole("tree", { name: "Proposed changes" })).toBeVisible();

    // Every proposed op's node belongs to the platform Thing.
    const proposalId = new URL(page.url()).searchParams.get("proposal")!;
    const proposal = await (await request.get(`/api/systems/${SYS}/intents/${proposalId}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })).json() as { ops: { node: string }[] };
    const model = await (await request.get(`/api/systems/${SYS}/model`)).json() as { genomeCommit: string; model: { nodes: { id: string; owningThing?: string }[] } };
    expect(proposal.ops.length).toBeGreaterThan(0);
    for (const op of proposal.ops) expect(model.model.nodes.find((n) => n.id === op.node)?.owningThing).toBe("thing.platform");
    await checkPage(page, testInfo, "self-proposal");

    // Agree every root of the agreement tree (Things), then accept. Children inherit ("mixed") and are skipped.
    for (const agree of await page.getByRole("tree", { name: "Proposed changes" }).getByRole("button", { name: /^Agree / }).all()) {
      if ((await agree.getAttribute("aria-pressed")) === "false") await agree.click();
    }
    await page.getByRole("button", { name: "Accept agreed" }).click();
    await expect(page).toHaveURL(/\/work\?.*realization=/);
    const rid = new URL(page.url()).searchParams.get("realization")!;
    await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();

    // Acceptance commits the exact Genome delta. Compare the snapshot captured before acceptance with that candidate.
    const { candidates } = await (await request.get(`/api/systems/${SYS}/candidates`)).json() as { candidates: { id: string; realization: string }[] };
    const candidate = candidates.find((c) => c.realization === rid)!;
    await page.goto(`${BASE}/compare?from=${encodeURIComponent(model.genomeCommit)}&to=${encodeURIComponent(candidate.id)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await page.getByRole("tab", { name: "Genome" }).click();
    await expect(page.getByText(proposal.ops[0]!.node).first()).toBeVisible();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`^thing\\.platform/.*${proposal.ops[0]!.node}/node\\.yaml$`) })).toBeVisible();
    await checkPage(page, testInfo, "self-compare-files", undefined, ['[data-op] > [class*="num"]']);
  });
});
