import { expect, test } from "@playwright/test";
import type { PartRecord } from "../shared/api";
import type { ModelJson } from "../src/model/types";
import { checkA11yAndShoot, SYSTEM } from "./helpers";
import { defaultMockData, mockApi, SID } from "./mockApi";

const THING = `${SYSTEM}/things/thing.webapp`;

test("shared Parts expose immutable provenance and payload @fixture", async ({ page }, testInfo) => {
  const data = await mockApi(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Button system" }).click();
  await expect(page).toHaveURL(/\/parts\/part.ui.buttons\/2.1.0$/);
  await expect(page.getByRole("heading", { level: 1, name: "Button system" })).toBeVisible();
  await expect(page.getByTitle(data.partRecords["part.ui.buttons@2.1.0"]!.digest, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payload" })).toBeVisible();
  await expect(page.getByText("No saved commands.")).toBeVisible();
  await checkA11yAndShoot(page, testInfo, "shared-part-detail");
});

test("direct Thing routes retain a full workspace as the System grows and distinguish outputs @fixture", async ({ page }, testInfo) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  model.things.push({ ...model.things[0]!, id: "thing.notes", name: "Notes", description: "Genome-only", templateRef: null, sections: [], artifacts: [], parts: [] });
  const original = data.artifacts[0]!;
  data.artifacts.push({ ...original, id: "output.build.3", build: "build.3", locator: "workers-version:mock-v3" });
  data.artifacts.push({ ...original, id: "output.unsafe-locator", build: "build.4", locator: "javascript:alert(1)" });
  data.phenome.events = data.phenome.events.map((event, index) => ({ ...event, outputId: index % 2 ? original.id : "output.build.3", genomeCommit: original.genomeCommit }));
  data.phenome.versions = [
    { key: "output.build.3", output: "output.build.3", genomeCommit: original.genomeCommit, buildId: original.source.commit, commit: original.source.commit, deployment: null, systemCommit: "sc-2", count: 3 },
    { key: original.id, output: original.id, genomeCommit: original.genomeCommit, buildId: original.source.commit, commit: original.source.commit, deployment: null, systemCommit: "sc-2", count: 2 },
  ];
  await mockApi(page, data);
  await page.goto(THING);
  await expect(page.getByRole("heading", { level: 1, name: "Peopling web app" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source artifacts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Realized outputs" })).toBeVisible();
  await expect(page.getByText("workers-version:mock-v2", { exact: true })).toBeVisible();
  await expect(page.getByText("workers-version:mock-v3", { exact: true })).toBeVisible();
  await expect(page.getByText("javascript:alert(1)", { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.getByRole("navigation", { name: "Views", exact: true }).getByRole("link", { name: "Code" }).click();
  await expect(page).toHaveURL(new RegExp(`${THING}/code$`));
  await expect(page.getByRole("tab", { name: "Genome" })).toBeVisible();
  await expect(page.getByText("Showing the whole System")).toBeVisible();
  await page.getByRole("navigation", { name: "Views", exact: true }).getByRole("link", { name: "Deployments" }).click();
  await expect(page).toHaveURL(new RegExp(`${THING}/phenome$`));
  await expect(page.locator("summary").filter({ hasText: "events" })).toHaveCount(2);
  await checkA11yAndShoot(page, testInfo, "thing-deployments");
  await page.getByRole("navigation", { name: "Scope", exact: true }).getByRole("link", { name: "Peopling", exact: true }).click();
  await expect(page).toHaveURL(`${page.url().split(SYSTEM)[0]}${SYSTEM}/overview`);
  await page.goto(`${SYSTEM}/things/thing.notes`);
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  await expect(page.getByText("No pinned Parts. This Thing can be Genome-only.")).toBeVisible();
  await expect(page.getByText(/No source artifacts recorded/)).toBeVisible();
  await expect(page.getByText(/No realized outputs for this Thing/)).toBeVisible();
  await checkA11yAndShoot(page, testInfo, "genome-only-thing");
});

test("private Parts remain inside their System and authorize inspection @fixture", async ({ page }, testInfo) => {
  await mockApi(page);
  const part: PartRecord = {
    package: { id: "part.private", version: "1.0.0", name: "Private logic", visibility: "system-private", systemId: SID, published: true, inputs: [], commands: [{ id: "compile", run: "echo inert", purpose: "Build" }], payload: { model: {}, files: {} } },
    scope: { kind: "system", systemId: SID }, digest: `sha256:${"b".repeat(64)}`, publishedAt: "2026-10-12T12:00:00Z",
  };
  await page.route(`**/api/systems/${SID}/parts**`, async (route) => {
    if (route.request().headers().authorization !== "Bearer admin-test") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "unauthorized", message: "Unauthorized" } }) });
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/parts") ? { parts: [{ partId: part.package.id, version: part.package.version, name: part.package.name, scope: part.scope, digest: part.digest, publishedAt: part.publishedAt, dependencies: [] }] } : { part };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await expect(page.getByText("Private logic")).toHaveCount(0);
  await page.getByRole("link", { name: "Peopling", exact: true }).click();
  await page.getByRole("link", { name: "Private Parts", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Private Parts" })).toBeVisible();
  await page.getByLabel("Admin token or realization secret").fill("wrong");
  await page.getByRole("button", { name: "Load private Parts" }).click();
  await expect(page.getByRole("alert")).toContainText("not authorized");
  await page.getByLabel("Admin token or realization secret").fill("admin-test");
  await page.getByRole("button", { name: "Load private Parts" }).click();
  await page.getByRole("button", { name: "Private logic 1.0.0" }).click();
  await expect(page.getByRole("heading", { name: "Payload" })).toBeVisible();
  await expect(page.getByText(/echo inert/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkA11yAndShoot(page, testInfo, "private-parts-narrow");
});
