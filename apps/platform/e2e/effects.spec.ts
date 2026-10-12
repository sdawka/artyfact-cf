import { expect, test } from "@playwright/test";
import { checkA11yAndShoot } from "./helpers";

test.describe("effects on /style", () => {
  test("renders every orb preset and the ambient field, decorative and switchable", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/style");
    await expect(page.getByRole("heading", { level: 2, name: "Signature effects" })).toBeVisible();
    const effects = page.locator("[data-effect]");
    await expect(effects).toHaveCount(6);
    // WebGL2 where the runner has it (SwiftShader in CI), the CSS fallback otherwise; never stuck pending.
    for (const el of await effects.all()) await expect(el).toHaveAttribute("data-effect-mode", /^(gl|fallback)$/);
    for (const canvas of await page.locator("[data-effect] canvas").all()) await expect(canvas).toHaveAttribute("aria-hidden", "true");
    await page.locator("[data-preset=tide]").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Pulse ember" }).click();
    // The marker-link sample above the effects already fails link-in-text-block (it predates this spec); exclude it.
    await checkA11yAndShoot(page, testInfo, "style-effects", ["a.u-marker"]);

    await page.getByLabel("Effects on").uncheck();
    for (const el of await effects.all()) await expect(el).toHaveAttribute("data-effect-mode", "fallback");
    await expect(page.locator("[data-effect] canvas")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
