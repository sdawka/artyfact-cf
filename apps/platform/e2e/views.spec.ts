import { expect, test } from "@playwright/test";
import { checkA11yAndShoot, open, successToneElements } from "./helpers";
import { mockApi } from "./mockApi";

test.describe("views", () => {
  test("overview: P1, three meters with distinct captions, literal unknown", async ({ page }, testInfo) => {
    await open(page, "/overview", "Peopling");
    // The Purpose lead sits under the System name; the full Purpose is collapsed.
    await expect(page.getByText(/Help an individual keep in touch/)).toBeVisible();
    await expect(page.getByText("Purpose in full")).toBeVisible();
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
    await page.goto("/s/system.peopling/r/head/map?focus=screen.people&inspect=1&layer=phenome");
    const crumbs = page.getByRole("navigation", { name: "Map scope" });
    await expect(crumbs).toBeVisible();
    const text = (await crumbs.innerText()).replace(/\s+/g, " ");
    const order = ["Peopling", "Peopling web app", "UI", "People"].map((n) => text.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    // Phenome tiles carry words for non-zero counts only; with no evaluations promoted there is no pass count, and nothing is green.
    const counters = page.locator(".react-flow [data-counter]");
    await expect(counters.first()).toBeVisible();
    await expect(page.locator('.react-flow [data-counter="pass"]')).toHaveCount(0);
    await expect(page.locator('.react-flow [data-tone="pass"]')).toHaveCount(0);
    const notRun = page.locator('.react-flow [data-counter="notRun"]');
    await expect(notRun.first()).toBeVisible();
    await expect(notRun.first()).toContainText(/\d+ not run/);
    await checkA11yAndShoot(page, testInfo, "map-phenome");
  });

  test("journeys: failure edge and step click opens the Inspector", async ({ page }, testInfo) => {
    await page.goto("/s/system.peopling/r/head/journeys?journey=J.contacts");
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

  test("code: read-only tree and editor, a local edit, and Commit disabled with its reason @fixture", async ({ page }, testInfo) => {
    // The System's own node.yaml, at the Genome's root (every node directory has one).
    await open(page, "/code?path=node.yaml", "Code");
    const content = page.locator(".cm-content");
    await expect(content).toHaveAttribute("aria-readonly", "true");
    await expect(page.getByText("read-only · canonical")).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(content).toHaveAttribute("aria-readonly", "false");
    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n# edited in the browser");
    await expect(page.getByText("editing · 1 pending")).toBeVisible();
    await page.getByRole("link", { name: "Commit…" }).click();
    const sheet = page.getByRole("complementary", { name: "Commit" });
    await expect(sheet.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
    await expect(sheet.getByText("Commit needs the platform API.")).toBeVisible();
    await checkA11yAndShoot(page, testInfo, "code-commit");
  });

  test("the success-tone detector can see a pass tone (guards the never-green checks) @fixture", async ({ page }) => {
    await open(page, "/overview", "Peopling");
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
    await open(page, "/overview", "Peopling");
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

  test("changelog empty state is never green @fixture", async ({ page }, testInfo) => {
    await open(page, "/changelog", "Changelog");
    await expect(page.getByText(/No System commits yet/)).toBeVisible();
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "changelog-empty");
  });

  test("changelog: ?commit= expands the entry; only a passed build and a pass verdict are green @fixture", async ({ page }, testInfo) => {
    await mockApi(page);
    await open(page, "/changelog?commit=sc-2", "Changelog");
    const list = page.getByRole("list", { name: "System commits, newest first" });
    await expect(list.getByRole("button", { name: /^sc-2/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("nodes +2 ~1 −0 · 4 files · 3 criteria")).toBeVisible();
    const files = page.getByRole("region", { name: "Files" });
    await expect(files.getByRole("link", { name: "src/screens/People.tsx" })).toHaveAttribute("href", /\/r\/sc-2\/code\?repo=app&path=src%2Fscreens%2FPeople\.tsx/);
    await expect(page.getByRole("link", { name: "Compare with parent" })).toBeVisible();
    // Green only inside a tagged pass element (the badge's ✓ glyph included), and every tagged one says pass/passed.
    for (const hit of await successToneElements(page)) expect(hit).toMatch(/pass|: ✓$/);
    for (const text of await page.locator('[data-tone="pass"]').allInnerTexts()) expect(text).toMatch(/pass/);
    await checkA11yAndShoot(page, testInfo, "changelog-entry");
  });

  test("compare: file level shows a line diff of an added file @fixture", async ({ page }, testInfo) => {
    await mockApi(page);
    await open(page, "/compare?level=files&path=src/screens/People.tsx", "Compare");
    await expect(page.getByRole("combobox", { name: "From", exact: true })).toHaveText("sc-1 · Initial import");
    await expect(page.getByRole("combobox", { name: "To", exact: true })).toHaveText("head");
    const diff = page.getByRole("table", { name: "src/screens/People.tsx" });
    await expect(diff.locator('[data-op="add"]')).toHaveCount(3);
    await expect(diff.locator('[data-op="del"]')).toHaveCount(0);
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "compare-files");
  });

  test("compare: System level table @fixture", async ({ page }, testInfo) => {
    await mockApi(page);
    await open(page, "/compare", "Compare");
    await expect(page.getByRole("table", { name: "System commits compared" })).toBeVisible();
    await checkA11yAndShoot(page, testInfo, "compare-system");
  });

  test("deployments: one empty state with a next step, and nothing is green", async ({ page }, testInfo) => {
    await open(page, "/phenome", "Deployments");
    await expect(page.getByText("No builds or deployments yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Review" })).toBeVisible();
    await expect(page.getByText(/— unknown/)).toHaveCount(0);
    expect(await successToneElements(page)).toEqual([]);
    await checkA11yAndShoot(page, testInfo, "deployments");
  });
});
