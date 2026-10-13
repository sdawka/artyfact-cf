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

    // A question, if the router asked one, gets an answer (the fake is confident for this message, so usually none).
    const reply = page.getByRole("button", { name: "Reply", exact: true });
    if ((await page.getByRole("heading", { name: "Questions" }).count()) > 0) {
      await page.getByRole("textbox").last().fill("The People screen.");
      await reply.click();
    }

    await page.getByRole("button", { name: "Accept selected" }).click();

    // Work: the candidate row with its gates, opened for review, under an Evolution that lists the touched node.
    await expect(page).toHaveURL(/\/work\?.*realization=/);
    const rid = new URL(page.url()).searchParams.get("realization")!;
    await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();
    const row = page.getByTestId(`realization-${rid}`);
    await expect(row).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Change what the People screen says" })).toBeVisible();
    await expect(page.getByText("screen.people").first()).toBeVisible();
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
});
