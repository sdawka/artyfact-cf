import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, checkPage, sweepViews } from "./fake";

/** Artyfact describing itself: the platform here is seeded with the repo-root `genome/` (`FAKE_SEED=artyfact`). */
const SYS = "system.artyfact";
const BASE = `/s/${SYS}/r/head`;
const THINGS = ["ci", "cli", "effects", "model", "ontology", "platform", "rules", "semantic", "site", "templates"].map((t) => `thing.${t}`);

test.describe("the self-model @fake", () => {
  test("Home shows Artyfact with its ten Things @fake", async ({ page, request }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Systems" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Artyfact/ }).first()).toBeVisible();
    await expect(page.getByText("fixture data")).toHaveCount(0);
    await checkPage(page, testInfo, "self-home");
    const model = await (await request.get(`/api/systems/${SYS}/model`)).json() as { model: { system: { things: string[] } } };
    expect(model.model.system.things).toEqual(THINGS);
  });

  test("the Map bands a Thing by template layer and the Inspector orders fields by the view hints @fake", async ({ page, request }, testInfo) => {
    const { model } = await (await request.get(`/api/systems/${SYS}/model`)).json() as { model: { views: { layers: { id: string }[] } } };
    // System scope: Things have no Map layer, so the canvas looks through them to the layer bands; the containment tree lists all ten.
    await page.goto(`${BASE}/map`);
    const tree = page.getByRole("tree", { name: "Containment" });
    for (const t of THINGS) await expect(tree.locator(`#map-tree-${t.replace(".", "_")}`)).toHaveAttribute("role", "treeitem");
    await expect(tree.getByRole("treeitem").filter({ hasText: ", Thing" })).toHaveCount(THINGS.length);
    await expect(page.locator("[data-map-band]").first()).toBeVisible();
    expect(await page.locator("[data-map-node]").evaluateAll((els) => els.map((e) => e.getAttribute("data-map-node")!).filter((id) => id.startsWith("thing.")))).toEqual([]);

    await page.goto(`${BASE}/map?focus=thing.platform`);
    const bands = page.locator("[data-map-band]");
    await expect(bands.first()).toBeVisible();
    const ids = await bands.evaluateAll((els) => els.map((e) => e.getAttribute("data-map-band")!));
    expect(ids).toEqual(expect.arrayContaining(["experience", "domain", "runtime"]));
    // Bands run left to right in template layer order.
    const order = model.views.layers.map((l) => l.id).filter((id) => ids.includes(id));
    expect(ids).toEqual(order);
    const xs = await bands.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    // The Kinds filter lists the kinds drawn here with their template labels.
    await page.getByText("Kinds", { exact: true }).click();
    await expect(page.getByRole("group", { name: "Kinds shown" }).getByRole("checkbox", { name: /Endpoint/ })).toBeVisible();
    await checkPage(page, testInfo, "self-map-bands");

    // A worker-service endpoint: Route, Auth, Request, Response in the template's field order.
    await page.goto(`${BASE}/map?focus=endpoint.apply-template-upgrade`);
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector.getByText("Route", { exact: true })).toBeVisible();
    const text = await inspector.innerText();
    const at = ["Route", "Auth", "Request", "Response"].map((l) => text.lastIndexOf(`\n${l}\n`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    await expect(inspector.getByText("POST /api/systems/:id/template-upgrade")).toBeVisible();
    await checkPage(page, testInfo, "self-inspector-hints");
  });

  test("every view renders for Artyfact without console errors @fake", async ({ page }, testInfo) => {
    await sweepViews(page, testInfo, BASE, "self");
  });

  test("an intent about the intents endpoint proposes ops under the platform Thing; Compare shows the change at that depth @fake", async ({ page, request }, testInfo) => {
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);
    await page.goto(`${BASE}/work?panel=intent`);
    await page.getByLabel("What should change?").fill("add rate limiting to the intents endpoint");
    await page.getByRole("button", { name: "Propose changes" }).click();
    await expect(page.getByText("provider fake")).toBeVisible();
    await expect(page.getByText("1 of 1 selected")).toBeVisible();

    // Every proposed op's node belongs to the platform Thing.
    const proposalId = new URL(page.url()).searchParams.get("proposal")!;
    const proposal = await (await request.get(`/api/systems/${SYS}/intents/${proposalId}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })).json() as { ops: { node: string }[] };
    const model = await (await request.get(`/api/systems/${SYS}/model`)).json() as { model: { nodes: { id: string; owningThing?: string }[] } };
    expect(proposal.ops.length).toBeGreaterThan(0);
    for (const op of proposal.ops) expect(model.model.nodes.find((n) => n.id === op.node)?.owningThing).toBe("thing.platform");
    await checkPage(page, testInfo, "self-proposal");

    await page.getByRole("button", { name: "Accept selected" }).click();
    await expect(page).toHaveURL(/\/work\?.*realization=/);
    const rid = new URL(page.url()).searchParams.get("realization")!;
    await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();

    // Intents accept as a candidate, not a head commit: Compare head with the candidate. Files depth names the node's file under the platform Thing.
    const { candidates } = await (await request.get(`/api/systems/${SYS}/candidates`)).json() as { candidates: { id: string; realization: string }[] };
    const candidate = candidates.find((c) => c.realization === rid)!;
    await page.goto(`${BASE}/compare?from=head&to=${encodeURIComponent(candidate.id)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await page.getByRole("tab", { name: "Genome" }).click();
    await expect(page.getByText(proposal.ops[0]!.node).first()).toBeVisible();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`^thing\\.platform/.*${proposal.ops[0]!.node}/node\\.yaml$`) })).toBeVisible();
    await checkPage(page, testInfo, "self-compare-files", undefined, ['[data-op] > [class*="num"]']);
  });
});
