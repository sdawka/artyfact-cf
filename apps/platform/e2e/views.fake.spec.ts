import { test } from "@playwright/test";
import { BASE, sweepViews } from "./fake";

test.describe("views on the fake platform @fake", () => {
  test("every view renders for Keep in Touch without console errors @fake", async ({ page }, testInfo) => {
    await sweepViews(page, testInfo, BASE, "kit");
  });
});
