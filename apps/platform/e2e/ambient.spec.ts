import { expect, test, type Page } from "@playwright/test";
import { checkA11yAndShoot, open, SYSTEM } from "./helpers";

/** Captures every `artyfact:fx` event into `window.__fx`. */
async function recordFx(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __fx: unknown[] };
    w.__fx = [];
    window.addEventListener("artyfact:fx", (e) => w.__fx.push((e as CustomEvent).detail));
  });
}
const fxEvents = (page: Page) => page.evaluate(() => (window as unknown as { __fx: { kind: string; x?: number; y?: number }[] }).__fx);
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-artifacts/fx-${name}.png` });

test.describe("ambient shell", () => {
  test("one fixed field behind the Shell, decorative, with veiled chrome", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, "/overview", "Overview");
    const field = page.locator("[data-shell-ambient] [data-effect=ambient]");
    await expect(field).toHaveCount(1);
    await expect(field).toHaveAttribute("data-effect-mode", /^(gl|fallback)$/);
    await expect(field).toHaveCSS("position", "fixed");
    await expect(page.locator("[data-shell-ambient]")).toHaveAttribute("data-health", /^(failing|blocked|passing|pending)$/);
    for (const canvas of await field.locator("canvas").all()) await expect(canvas).toHaveAttribute("aria-hidden", "true");
    // Chrome is translucent over the field, and the field never takes clicks.
    await expect(page.locator("header").first()).not.toHaveCSS("backdrop-filter", "none");
    await expect(field).toHaveCSS("pointer-events", "none");
    await checkA11yAndShoot(page, testInfo, "ambient-overview");
    await shot(page, "shell");
    expect(errors).toEqual([]);
  });

  test("Effects switch turns WebGL off, persists, and the palette offers it", async ({ page }) => {
    await open(page, "/overview", "Overview");
    const toggle = page.getByRole("button", { name: /Effects/ });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-shell-ambient] [data-effect]")).toHaveAttribute("data-effect-mode", "fallback");
    await expect(page.locator("[data-shell-ambient] canvas")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /Effects/ })).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill("effects");
    await page.getByRole("option", { name: /Turn effects on/ }).click();
    await expect(page.getByRole("button", { name: /Effects/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("reduced motion defaults the switch off", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await open(page, "/overview", "Overview");
    await expect(page.getByRole("button", { name: /Effects/ })).toHaveAttribute("aria-pressed", "false");
    await context.close();
  });

  test("artyfact:fx ripples and tints the field by kind", async ({ page }) => {
    // The Map's open canvas shows the field best (the Overview is mostly opaque cards).
    await open(page, "/map", "Map");
    await page.mouse.move(700, 450);
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("artyfact:fx", { detail: { kind: "promoted", x: 700, y: 420 } })),
    );
    await expect(page.locator("[data-shell-ambient]")).toHaveAttribute("data-accent", /oklch\(0\.723/);
    await page.waitForTimeout(250);
    await shot(page, "ripple-promoted");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("artyfact:fx", { detail: { kind: "fail", x: 640, y: 380 } })));
    await expect(page.locator("[data-shell-ambient]")).toHaveAttribute("data-accent", /oklch\(0\.686/);
    await page.waitForTimeout(250);
    await shot(page, "ripple-fail");
    await expect(page.locator("[data-shell-ambient]")).not.toHaveAttribute("data-accent", /./, { timeout: 4_000 });
  });

  test("map: selection glows, its edges flow, and it ripples from the node", async ({ page }, testInfo) => {
    await recordFx(page);
    await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
    await expect(page.getByRole("heading", { level: 1, name: "Map" })).toBeVisible();
    const node = page.locator('.react-flow__node[data-id="section.ui"]');
    await expect(node).toBeVisible();
    // Selection reveals connections without opening Details or moving the camera.
    const box = (await node.boundingBox())!;
    await node.click();
    await expect(node.locator("[data-selected]")).toBeVisible();
    await expect(node.locator("[data-selected]")).not.toHaveCSS("box-shadow", "none");
    await expect(page.locator("[data-edge-flow]").first()).toBeAttached();
    await expect.poll(async () => (await fxEvents(page)).filter((e) => e.kind === "select").length).toBeGreaterThan(0);
    const sel = (await fxEvents(page)).find((e) => e.kind === "select")!;
    expect(sel.x!).toBeGreaterThanOrEqual(box.x - 1);
    expect(sel.x!).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(sel.y!).toBeGreaterThanOrEqual(box.y - 1);
    expect(sel.y!).toBeLessThanOrEqual(box.y + box.height + 1);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    await shot(page, "map-selection");
    await checkA11yAndShoot(page, testInfo, "ambient-map");

    // Frame cost while panning the Map with the field running (reported, not asserted: CI GPUs vary).
    const canvas = page.locator(".react-flow__pane");
    const cb = (await canvas.boundingBox())!;
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] };
      w.__frames = [];
      let last = performance.now();
      const tick = (t: number) => {
        w.__frames.push(t - last);
        last = t;
        if (w.__frames.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(cb.x + cb.width * 0.8, cb.y + cb.height * 0.8);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(cb.x + cb.width * (0.8 - i * 0.008), cb.y + cb.height * (0.8 - i * 0.006), { steps: 2 });
    await page.mouse.up();
    const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames.slice(5));
    const sorted = [...frames].sort((a, b) => a - b);
    const stat = { frames: frames.length, mean: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1) };
    testInfo.annotations.push({ type: "frame-ms", description: JSON.stringify(stat) });
    console.log("map pan frame ms", JSON.stringify(stat));
  });

  test("journeys: selected step glows, its edges flow, and it ripples", async ({ page }, testInfo) => {
    await recordFx(page);
    await page.goto(`${SYSTEM}/journeys?journey=J.contacts`);
    await expect(page.getByRole("heading", { level: 1, name: "Journeys" })).toBeVisible();
    const step = page.getByRole("button", { name: /^Step s2:/ });
    await step.click();
    await expect(step).toHaveAttribute("aria-pressed", "true");
    await expect(step).not.toHaveCSS("box-shadow", "none");
    await expect(page.locator("[data-edge-flow]").first()).toBeAttached();
    await expect(page.getByRole("button", { name: /^Step f1:.*failure/ })).not.toHaveCSS("box-shadow", "none");
    await expect.poll(async () => (await fxEvents(page)).filter((e) => e.kind === "select").length).toBe(1);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    await shot(page, "journeys-selection");
    await checkA11yAndShoot(page, testInfo, "ambient-journeys");
  });
});
