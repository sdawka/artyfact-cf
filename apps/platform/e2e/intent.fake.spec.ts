import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, auth, BASE, checkPage, SYS } from "./fake";

test.describe("describe a change by intent @fake", () => {
  test("message, routed path, op toggle, accept, candidate with gates, Evolution, packet scope @fake", async ({ page, request }, testInfo) => {
    // The header's admin token lives in sessionStorage; seed it before the SPA boots.
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);
    await page.goto(`${BASE}/work`);
    await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
    await page.getByRole("button", { name: "Describe a change", exact: true }).click();
    await page.getByLabel("What should change?").fill("Change what the People screen says");
    await checkPage(page, testInfo, "intent-form");
    await page.getByRole("button", { name: "Propose changes" }).click();

    // The routed path, provider label and the one op the fake translator proposes.
    const routed = page.getByRole("region", { name: "Routed path" }).or(page.getByRole("heading", { name: "Routed path" }).locator(".."));
    await expect(routed.getByText("screen.people", { exact: true })).toBeVisible();
    await expect(page.getByText("provider fake")).toBeVisible();
    await expect(page.getByText("1 of 1 selected")).toBeVisible();
    await checkPage(page, testInfo, "intent-proposal");

    // Toggle the op off: nothing is left to accept. Toggle it back on.
    const toggle = page.getByRole("checkbox").first();
    await toggle.uncheck();
    await expect(page.getByText("0 of 1 selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept selected" })).toBeDisabled();
    await toggle.check();

    await page.getByRole("button", { name: "Accept selected" }).click();

    // Work: the candidate row with its gates, opened for review, under an Evolution that lists the touched node.
    await expect(page).toHaveURL(/\/work\?.*realization=/);
    const rid = new URL(page.url()).searchParams.get("realization")!;
    await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();
    const row = page.getByTestId(`realization-${rid}`);
    await expect(row).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Change what the People screen says" })).toBeVisible();
    // The candidate's gates: the Evaluations tab lists the criteria with their verdicts (fake provider, so nothing is green without a pass).
    const review = page.getByRole("region", { name: `Review ${rid}` });
    await review.getByRole("tab", { name: "Evaluations" }).click();
    await expect(review.getByRole("row", { name: /Changed nodes meet their checks/ })).toContainText("pass");
    await expect(review.getByRole("row", { name: /People screen/ }).first()).toContainText("not-run");
    // The Evolution's own panel names the touched node.
    await expect(page.getByRole("heading", { level: 2, name: "Change what the People screen says" }).locator("..").getByText("People").first()).toBeVisible();
    await checkPage(page, testInfo, "intent-accepted", undefined, ['[class*="markdown"] > pre']);

    // The Evolution lists the touched node, and an app realization of it is scoped by that node's `files`.
    const evoId = new URL(page.url()).searchParams.get("evolution")!;
    const work = await (await request.get(`/api/systems/${SYS}/work`)).json() as { evolutions: { id: string; affectedNodes: string[]; kind: string }[] };
    const evo = work.evolutions.find((e) => e.id === evoId)!;
    expect(evo.kind).toBe("genome-amendment");
    expect(evo.affectedNodes).toEqual(["screen.people"]);
    const started = await request.post(`/api/systems/${SYS}/evolutions/${evoId}/realizations`, { headers: auth, data: { target: "app", origin: "editor", agentLabel: "human:e2e", role: "implementer" } });
    expect(started.ok(), await started.text()).toBe(true);
    const { packet } = await started.json() as { packet: { permittedPaths: string[] } };
    expect(packet.permittedPaths).toContain("public/people/**");
  });

  test("an unconfident route asks a question and a reply revises the proposal @fake", async ({ page, request }, testInfo) => {
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);
    await page.goto(`${BASE}/work?panel=intent`);
    // #s1low is a fake System One directive: low confidence, so the router asks instead of routing.
    await page.getByLabel("What should change?").fill("Change what the People screen says #s1low");
    await page.getByRole("button", { name: "Propose changes" }).click();
    await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
    await expect(page.getByText("Which of these is it about")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept selected" })).toHaveCount(0);
    const proposalId = new URL(page.url()).searchParams.get("proposal")!;
    const get = async () => (await (await request.get(`/api/systems/${SYS}/intents/${proposalId}`, { headers: auth })).json()) as { status: string; ops: unknown[]; questions: { id: string }[] };
    expect((await get()).questions.map((q) => q.id)).toEqual(["q.1"]);
    await checkPage(page, testInfo, "intent-question");

    await page.getByRole("textbox").last().fill("The People screen.");
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    // The reply runs a new turn: the proposal stays open and its question is replaced (the directive still keeps confidence low).
    await expect.poll(async () => (await get()).questions.map((q) => q.id)).toEqual(["q.2"]);
    expect((await get()).status).toBe("open");
    await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
  });
});
