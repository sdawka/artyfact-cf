import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, open, successToneElements } from "./helpers";

test.describe("views", () => {
  test("overview: P1, three meters with distinct captions, literal unknown", async ({ page }, testInfo) => {
    await open(page, "/overview", "Overview");
    await expect(page.getByRole("heading", { name: "P1 Purpose" })).toBeVisible();
    const meters = ["Model readiness", "Implementation conformance", "Outcome progress"];
    for (const title of meters) await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    // Each meter has its own "what it is not" caption, so the three texts are all different.
    const captions: string[] = [];
    for (const title of meters) {
      const caption = page.getByRole("region", { name: title }).locator("p").last();
      await expect(caption).not.toBeEmpty();
      captions.push((await caption.innerText()).trim());
    }
    expect(new Set(captions).size).toBe(3);
    await expect(page.getByRole("region", { name: "Outcome progress" }).getByText("unknown", { exact: true }).first()).toBeVisible();
    await checkA11yAndShoot(page, testInfo, "overview");
  });

  test("map: breadcrumbs and grey phenome badges", async ({ page }, testInfo) => {
    await page.goto("/s/system.keep-in-touch/r/head/map?focus=screen.people&layer=phenome");
    const crumbs = page.getByRole("navigation", { name: "Map scope" });
    await expect(crumbs).toBeVisible();
    const text = (await crumbs.innerText()).replace(/\s+/g, " ");
    const order = ["Keep in Touch", "Keep in Touch web app", "UI", "People"].map((n) => text.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    // No evaluations are promoted: the pass counter renders as a zero count in the disabled grey.
    const counters = page.locator(".react-flow [data-counter]");
    await expect(counters.first()).toBeVisible();
    expect(await counters.count()).toBeGreaterThan(0);
    const passCounters = page.locator('.react-flow [data-counter="pass"]');
    await expect(passCounters.first()).toBeVisible();
    await expect(page.locator('.react-flow [data-counter="pass"]:not([data-zero])')).toHaveCount(0);
    const grey = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-text-disabled)";
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    // Positively: not-run counters are present, non-zero, and paint the not-run token.
    const notRun = page.locator('.react-flow [data-counter="notRun"]:not([data-zero])');
    await expect(notRun.first()).toBeVisible();
    const notRunColor = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--verdict-not-run)";
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    for (const el of await notRun.all()) await expect(el).toHaveCSS("color", notRunColor);
    for (const el of await passCounters.all()) await expect(el).toHaveCSS("color", grey);
    await checkA11yAndShoot(page, testInfo, "map-phenome");
  });

  test("journeys: failure edge and step click opens the Inspector", async ({ page }, testInfo) => {
    await page.goto("/s/system.keep-in-touch/r/head/journeys?journey=J.contacts");
    await expect(page.getByRole("heading", { level: 1, name: "Journeys" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Step f1:.*failure/ })).toBeVisible();
    await expect(page.getByLabel("Edge from s4 to f1")).toBeAttached();
    await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Step s2:/ }).click();
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector).toBeVisible();
    await expect(page).toHaveURL(/focus=J\.contacts%2Fs2/);
    await checkA11yAndShoot(page, testInfo, "journeys-inspector");
  });

  test("theory: T1-T5 and the hypothesis banner", async ({ page }, testInfo) => {
    await open(page, "/theory", "Theory");
    await expect(page.getByText("Hypotheses, not a validated causal model")).toBeVisible();
    for (const col of ["Purpose", "Beneficiaries", "Activities", "Outputs", "Outcomes"]) {
      await expect(page.getByText(col, { exact: true }).first()).toBeVisible();
    }
    // T1-T5 are claim chips; the id is the chip's title, the name its label.
    for (const [id, name] of [["T1", "Remembering"], ["T2", "Initiating"], ["T3", "Meaning"], ["T4", "Autonomy"], ["T5", "Updates later"]]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}\\s*,?\\s*Claim`) }).first(), id).toBeVisible();
    }
    await checkA11yAndShoot(page, testInfo, "theory");
  });

  test("work: Start work is disabled with its reason @fixture", async ({ page }, testInfo) => {
    await open(page, "/work?evolution=evolution.1", "Work");
    await page.getByRole("button", { name: "Start work", exact: true, pressed: false }).click();
    const submit = page.locator('button[type="submit"]', { hasText: "Start work" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText("Start work needs the platform API. The UI is showing fixture data.")).toBeVisible();
    await checkA11yAndShoot(page, testInfo, "work-start");
  });

  test("the success-tone detector can see a pass tone (guards the never-green checks) @fixture", async ({ page }) => {
    await open(page, "/overview", "Overview");
    // The fixture has no non-zero pass count, so plant one: the detector must flag both a tagged and a painted element.
    await page.evaluate(() => {
      const tagged = document.createElement("span");
      tagged.dataset.tone = "pass";
      tagged.textContent = "1 pass";
      const painted = document.createElement("span");
      painted.style.color = "var(--verdict-pass)";
      painted.textContent = "1 pass";
      document.body.append(tagged, painted);
    });
    expect((await successToneElements(page)).length).toBeGreaterThanOrEqual(2);
  });

  test("overview paints no zero count in the success tone @fixture", async ({ page }) => {
    await open(page, "/overview", "Overview");
    const conformance = page.getByRole("region", { name: "Implementation conformance" });
    await expect(conformance).toContainText("pass");
    expect(await conformance.locator('[data-tone="pass"]').count()).toBe(0);
    expect(await successToneElements(page)).toEqual([]);
  });

  test("evaluations empty state is never green @fixture", async ({ page }, testInfo) => {
    await open(page, "/evaluations", "Evaluations");
    await expect(page.getByText("No evaluations yet — nothing is known")).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "evaluations-empty");
  });

  test("history empty state is never green @fixture", async ({ page }, testInfo) => {
    await open(page, "/history", "History");
    await expect(page.getByText(/No System commits yet/)).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "history-empty");
  });
});
