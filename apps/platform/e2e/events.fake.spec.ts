import { expect, test } from "@playwright/test";
import { auth, BASE, checkPage, isPass, SYS } from "./fake";

// Node chips inside an event <summary> are nested interactive controls (axe nested-interactive); reported to the Deployments slice.
const EVENT_SUMMARY = '[class*="event"] > summary';

test.describe("runtime events @fake", () => {
  test("events posted with the header are grouped by version on Deployments @fake", async ({ page, request }, testInfo) => {
    const { systems } = (await (await request.get("/api/systems")).json()) as { systems: { systemId: string; head: string; appCommit: string }[] };
    const sys = systems.find((s) => s.systemId === SYS)!;
    const commit = sys.appCommit;

    // A production deployment gives the app its ingest token.
    const dep = await request.post(`/api/systems/${SYS}/deployments`, { headers: auth, data: { kind: "production", url: "https://keep.example.workers.dev" } });
    expect(dep.ok(), await dep.text()).toBe(true);
    const { id: deploymentId, ingestToken } = (await dep.json()) as { id: string; ingestToken: string };

    const header = { systemId: SYS, thingId: "thing.webapp", artifactId: "artifact.webapp", buildId: commit, commit, systemCommit: sys.head, deploymentId };
    const res = await request.post(`/api/systems/${SYS}/phenome/events`, {
      headers: { Authorization: `Bearer ${ingestToken}` },
      data: {
        events: [
          { ...header, id: "e2e-1", emittedAt: new Date().toISOString(), kind: "journey.step", subject: "screen.people", payload: { step: "open" } },
          { ...header, id: "e2e-2", emittedAt: new Date().toISOString(), kind: "criterion.observed", subject: "screen.people", payload: { ok: true } },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);

    await page.goto(`${BASE}/phenome`);
    await expect(page.getByRole("heading", { level: 1, name: "Deployments" })).toBeVisible();
    const group = page.locator("details", { has: page.locator("summary", { hasText: commit.slice(0, 7) }) }).first();
    await expect(group.locator("summary").first()).toContainText("2 events");
    await expect(group.locator("summary").first()).toContainText(sys.head);
    await group.locator("summary").first().click();
    await expect(group.getByText("journey.step").first()).toBeVisible();
    await expect(group.getByText("criterion.observed").first()).toBeVisible();
    await checkPage(page, testInfo, "deployments-events", isPass, [EVENT_SUMMARY]);

    // The deployment row links to the System commit it runs, and its events view filters to it.
    await page.getByRole("link", { name: "Events" }).first().click();
    await expect(page).toHaveURL(new RegExp(`deployment=${deploymentId}`));
    await checkPage(page, testInfo, "deployments-filtered", isPass, [EVENT_SUMMARY]);

    // Home counts the observation.
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Keep in Touch/ }).locator('[data-status="observed"]')).toBeVisible();
    await checkPage(page, testInfo, "home-observed");
  });
});
