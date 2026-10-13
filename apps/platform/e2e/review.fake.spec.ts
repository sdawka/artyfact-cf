import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, apiCommit, apiEvolution, auth, BASE, checkPage, isPass, SYS } from "./fake";

const binding = (node: string) => ({
  path: `thing.webapp/section.runtime/${node}/node.yaml`,
  content: `id: ${node}\nkind: binding\nfields:\n  name: ${node}\n  description: ${node} for the Review e2e\n`,
});

test.describe("Review: the decision queue @fake", () => {
  test("queue rows, open a candidate, the promotion desk, reject and accept amendments, a stale candidate's 409 @fake", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(([k, v]) => sessionStorage.setItem(k, v), ["artyfact.adminToken", ADMIN_TOKEN]);

    // An app candidate on the current head, and two Genome amendments awaiting an admin. Names are unique per run, so a
    // reused local server takes the test again.
    const run = Date.now().toString(36);
    const appEvo = await apiEvolution(request, "Review desk probe", "implementation", ["screen.people"]);
    const app = await apiCommit(request, appEvo, "app", "agent-review", [{ path: `public/people/review-${run}.txt`, content: `probe ${run}\n` }]);
    const keepEvo = await apiEvolution(request, "Review keeps a binding", "genome-amendment", ["section.runtime"]);
    const keep = await apiCommit(request, keepEvo, "genome", "agent-keep", [binding(`binding.keep${run}`)]);
    const dropEvo = await apiEvolution(request, "Review drops a binding", "genome-amendment", ["section.runtime"]);
    const drop = await apiCommit(request, dropEvo, "genome", "agent-drop", [binding(`binding.drop${run}`)]);

    await page.goto(`${BASE}/review`);
    await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
    const queue = page.getByRole("region", { name: /Waiting on you/ });
    const appRow = queue.getByTestId(`queue-${app.realization}`);
    await expect(appRow).toHaveAttribute("data-kind", "candidate");
    await expect(appRow).toContainText("agent-review");
    await expect(appRow).toContainText(app.candidate);
    await expect(appRow).toContainText("base = head");
    await expect(queue.getByTestId(`queue-${keep.realization}`)).toHaveAttribute("data-kind", "amendment");
    await expect(queue.getByTestId(`queue-promotion-${appEvo}`)).toHaveAttribute("data-kind", "promotion");
    // The rail count is the queue's length.
    const count = await queue.locator('[data-testid^="queue-"]').count();
    await expect(page.getByRole("link", { name: `Review, ${count} waiting` })).toBeVisible();
    await checkPage(page, testInfo, "review-queue");

    // Open the candidate: its review tabs on the right, the row marked current.
    await appRow.click();
    await expect(page).toHaveURL(new RegExp(`/review\\?evolution=${appEvo}&realization=${app.realization}$`));
    const review = page.getByRole("region", { name: `Review ${app.realization}` });
    await expect(review.getByRole("tab", { name: "Semantic delta" })).toBeVisible();
    await expect(review.getByRole("tab", { name: "Files" })).toBeVisible();
    await expect(appRow).toHaveAttribute("aria-current", "true");

    // The promotion desk: gates summary and the reasons Promote is disabled (the fake leaves required gates unknown).
    await queue.getByTestId(`queue-promotion-${appEvo}`).click();
    await expect(page).toHaveURL(new RegExp(`/review\\?evolution=${appEvo}&panel=promote$`));
    await expect(page.getByRole("heading", { name: "Promote Review desk probe" })).toBeVisible();
    // The selection lives in `?candidates=`, so the box follows the URL a moment after the click.
    const pick = page.getByRole("checkbox", { name: new RegExp(app.candidate) });
    await pick.click();
    await expect(pick).toBeChecked();
    await expect(page.getByTestId("gates-summary")).toContainText("pass");
    await expect(page.getByTestId("gates-summary")).not.toHaveAttribute("data-tone", "pass");
    await expect(page.getByRole("list", { name: "Why promotion is disabled" })).toBeVisible();
    await checkPage(page, testInfo, "review-promote");

    // Reject one amendment with a reason: it leaves the queue.
    await queue.getByTestId(`queue-${drop.realization}`).click();
    const dropReview = page.getByRole("region", { name: `Review ${drop.realization}` });
    const reason = page.getByRole("textbox", { name: "Rejection reason" });
    await expect(async () => {
      await dropReview.getByRole("tab", { name: "Amendment" }).click();
      await expect(reason).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await reason.fill("Not needed for this run.");
    await page.getByRole("button", { name: "Reject amendment" }).click();
    await expect(page.getByText(/Rejected\. Reason recorded/)).toBeVisible();
    await expect(queue.getByTestId(`queue-${drop.realization}`)).toHaveCount(0);

    // Accept the other with an interpretation: a new System commit, so the app candidate's base falls behind head.
    await queue.getByTestId(`queue-${keep.realization}`).click();
    const keepReview = page.getByRole("region", { name: `Review ${keep.realization}` });
    const interpretation = page.getByRole("textbox", { name: "Accepted interpretation" });
    await expect(async () => {
      await keepReview.getByRole("tab", { name: "Amendment" }).click();
      await expect(interpretation).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await interpretation.fill("The binding is part of the runtime.");
    await page.getByRole("button", { name: "Accept amendment" }).click();
    await expect(page.getByText(/Accepted\. New Genome commit/)).toBeVisible();
    await expect(queue.getByTestId(`queue-${keep.realization}`)).toHaveCount(0);
    await expect(appRow).toHaveAttribute("data-kind", "stale");
    await expect(appRow).toContainText("behind by 1");
    await expect(queue.getByTestId(`queue-promotion-${appEvo}`)).toHaveCount(0);
    // The accepted amendment's "benign class" confidence row is still painted in the pass tone (tolerated as in editGenomeAndAccept).
    await checkPage(page, testInfo, "review-stale", (h) => isPass(h) || /classRow|_num_|deliberate non-standard choice/.test(h));

    // The server agrees: promoting the stale candidate on the current head is a 409 stale-base.
    const { systems } = await (await request.get("/api/systems")).json() as { systems: { systemId: string; head: string }[] };
    const head = systems.find((s) => s.systemId === SYS)!.head;
    const refused = await request.post(`/api/systems/${SYS}/promote`, { headers: auth, data: { candidates: [app.candidate], expectedHead: head, rationale: "e2e" } });
    expect(refused.status()).toBe(409);
    expect(await refused.text()).toMatch(/stale-base.*rebase it on the current head and resubmit/);
  });
});
