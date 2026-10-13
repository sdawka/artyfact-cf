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
