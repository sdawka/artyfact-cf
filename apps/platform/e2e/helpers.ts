import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

export const SYSTEM = "/s/system.keep-in-touch/r/head";
export const live = process.env.ARTYFACT_E2E_LIVE === "1";

/** Wait for the lazy view to render its `<h1>` and the model to load. */
export async function open(page: Page, path: string, heading: string) {
  await page.goto(`${SYSTEM}${path}`);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

/** `exclude` lists selectors with a known, reported violation. Fails on any serious or critical axe violation; saves a full-page screenshot as an artifact. */
export async function checkA11yAndShoot(page: Page, testInfo: TestInfo, name: string, exclude: string[] = []) {
  const builder = new AxeBuilder({ page });
  for (const sel of exclude) builder.exclude(sel);
  const results = await builder.analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

/** Elements that render in the success tone: `data-tone`/`data-verdict` = pass, or the pass colour. */
export async function successToneElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--verdict-pass)";
    document.body.append(probe);
    const pass = getComputedStyle(probe).color;
    probe.style.color = "";
    probe.style.backgroundColor = "var(--verdict-pass-bg)";
    const passBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const hits: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const tagged = el.matches('[data-tone="pass"], [data-verdict="pass"]');
      const painted = ([cs.color, cs.backgroundColor, cs.borderTopColor, cs.fill].includes(pass) || cs.backgroundColor === passBg) && el.textContent?.trim() !== "";
      if (tagged || painted) hits.push(`${el.tagName.toLowerCase()}.${el.className}: ${el.textContent?.slice(0, 40)}`);
    }
    return hits;
  });
}

/** A System card link on Home; scoped to the Systems list because the Needs you ledger can repeat a System name. */
export const systemCard = (page: Page, name: RegExp) => page.getByRole("list", { name: "Systems" }).getByRole("link", { name: new RegExp(`^(?:${name.source})$`) });
