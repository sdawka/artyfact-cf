import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// A machine without a usable GPU (CI runners, blocklisted drivers): WebGL runs on SwiftShader, where a full-viewport
// field costs ~4x the frame budget and starves input. Effects must fall back to CSS there.
test.use({ launchOptions: { args: ["--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test("software renderer: the shell field uses the CSS fallback", async ({ page }) => {
  await open(page, "/map", "Map");
  const field = page.locator("[data-shell-ambient] [data-effect=ambient]");
  await expect(field).toHaveAttribute("data-effect-mode", "fallback");
  await expect(field.locator("canvas")).toHaveCount(0);
  // The switch stays on: the fallback is a capability decision, not the user's.
  await expect(page.getByRole("button", { name: /Effects/ })).toHaveAttribute("aria-pressed", "true");
});
