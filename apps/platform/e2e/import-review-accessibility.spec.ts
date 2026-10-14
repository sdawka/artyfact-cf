import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, SID } from "./mockApi";

const SYSTEM = SID;
const paths = Array.from({ length: 200 }, (_, index) => `src/unmapped/generated-${String(index).padStart(3, "0")}.ts`);

for (const width of [1440, 390]) {
  test(`unmapped import paths are keyboard-scrollable at ${width}px @fixture`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => sessionStorage.setItem("artyfact.adminToken", "test-admin"));
    await mockApi(page);
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/systems")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ systemId: SYSTEM, title: "Accessibility", head: null, genomeRepo: "genome", appRepo: "app", genomeCommit: "abcdef0123456789", evolutionCounts: {}, updatedAt: "", importReview: { status: "pending", genomeCommit: "abcdef0123456789", nodes: 1 } }]) });
      } else if (path.endsWith("/import-review")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "pending", genomeCommit: "abcdef0123456789", tree: [{ id: SYSTEM, kind: "system", title: "Accessibility", path: [SYSTEM], summary: "", opIds: [], children: [] }], findings: [], unmapped: paths, unmappedTotal: paths.length }) });
      }
      await route.fallback();
    });

    await page.goto(`/s/${SYSTEM}/r/head/review?panel=import`);
    const panel = page.getByRole("article", { name: "Import review" });
    await expect(panel).toBeVisible();
    const list = panel.getByRole("list", { name: "Unmapped app paths" });
    await expect(list).toBeVisible();
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    for (let tabs = 0; tabs < 40 && !(await list.evaluate((element) => element === document.activeElement)); tabs += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(list).toBeFocused();
    const start = await list.evaluate((element) => element.scrollTop);
    await page.keyboard.press("PageDown");
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(start);
    const afterPage = await list.evaluate((element) => element.scrollTop);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(afterPage);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
}
