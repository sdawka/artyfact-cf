import { test } from "@playwright/test";
import { BASE, sweepViews } from "./fake";

test.describe("views on the fake platform @fake", () => {
  test("every view renders for Peopling without console errors @fake", async ({ page }, testInfo) => {
    await sweepViews(page, testInfo, BASE, "peopling", "Peopling");
  });
});
