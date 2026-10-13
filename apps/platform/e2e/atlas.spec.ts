import { expect, test, type Page } from "@playwright/test";
import { checkA11yAndShoot, SYSTEM, systemCard } from "./helpers";
import { defaultMockData, mockApi, SID } from "./mockApi";
import type { ModelJson } from "../src/model/types";

const tile = (page: Page, id: string) => page.locator(`[data-map-node="${id}"]`);
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" });

// A regression here means the entry or projection dropped a declared actor, not that
// the fixture happened to contain a useful link to it.
test("System entry shows environment including disconnected declared actors @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  model.externals.push({ ...model.externals[0]!, id: "ext.disconnected", name: "Disconnected observer", kind: "person", links: [] });
  await mockApi(page, data);
  await page.goto("/");
  await systemCard(page, /Peopling/).click();
  await expect(page).toHaveURL(new RegExp(`${SYSTEM}/map\\?scope=environment$`));
  await expect(tile(page, SID)).toBeVisible();
  const environmentBoxes = await page.locator(".react-flow__node").evaluateAll((nodes) => nodes.map((node) => {
    const element = node as HTMLElement, position = new DOMMatrix(element.style.transform);
    return { id: element.dataset.id!, x: position.e, width: parseFloat(element.style.width) };
  }));
  const systemBox = environmentBoxes.find((box) => box.id === SID)!;
  const actorBoxes = environmentBoxes.filter((box) => box.id.startsWith("ext."));
  expect(Math.min(...actorBoxes.map((box) => box.x))).toBeLessThan(systemBox.x);
  expect(Math.max(...actorBoxes.map((box) => box.x))).toBeGreaterThanOrEqual(systemBox.x + systemBox.width);
  for (const external of model.externals) await expect(tile(page, external.id)).toBeVisible();
  await expect(tile(page, "thing.webapp")).toHaveCount(0);
  await expect(inspector(page)).toHaveCount(0);
});

const canvas = (page: Page) => page.getByTestId("atlas-canvas");
const selection = (page: Page) => page.getByRole("complementary", { name: "Map selection" });
async function scope(page: Page, id: string) {
  await expect(canvas(page)).toHaveAttribute("data-scope", id);
  expect(new URL(page.url()).searchParams.get("scope")).toBe(id);
}
async function geometry(page: Page) {
  return page.locator(".react-flow__node").evaluateAll((nodes) => nodes.map((node) => {
    const el = node as HTMLElement;
    return { id: el.dataset.id, transform: el.style.transform, width: el.style.width, height: el.style.height };
  }));
}
const camera = (page: Page) => page.locator(".react-flow__viewport").getAttribute("style");
async function tilePoint(page: Page, id: string) {
  const target = (await tile(page, id).boundingBox())!, frame = (await canvas(page).boundingBox())!;
  const left = Math.max(target.x, frame.x), right = Math.min(target.x + target.width, frame.x + frame.width);
  const top = Math.max(target.y, frame.y), bottom = Math.min(target.y + target.height, frame.y + frame.height);
  expect(right - left, "Gesture target must have a visible hit area").toBeGreaterThan(100);
  expect(bottom - top).toBeGreaterThan(60);
  return { x: left + (right - left) / 2, y: top + Math.min(65, (bottom - top) / 2) };
}


// This catches reintroduced template look-through and selection that silently enters scope.
test("direct containment, selection, Details and browser history keep separate URL state @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await page.getByRole("button", { name: "Enter Peopling", exact: true }).click();
  await scope(page, SID);
  await expect(tile(page, "thing.webapp")).toBeVisible();
  await expect(tile(page, "screen.people")).toHaveCount(0);
  await tile(page, "thing.webapp").click();
  await scope(page, SID);
  await expect(inspector(page)).toHaveCount(0);
  await selection(page).getByRole("button", { name: "Enter Peopling web app", exact: true }).click();
  await scope(page, "thing.webapp");
  for (const id of ["section.ui", "section.domain", "section.authorization", "section.runtime"]) await expect(tile(page, id)).toBeVisible();
  await tile(page, "section.ui").dblclick();
  await scope(page, "section.ui");
  await tile(page, "screen.people").click();
  await expect(inspector(page)).toHaveCount(0);
  await selection(page).getByRole("button", { name: "Details", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
  await scope(page, "section.ui");
  expect(new URL(page.url()).searchParams.get("inspect")).toBe("1");
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  await scope(page, "section.ui");
  await page.goBack();
  await scope(page, "thing.webapp");
  await page.goBack();
  await scope(page, SID);
  await page.goForward();
  await scope(page, "thing.webapp");
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await scope(page, SID);
});

test("explicit scope wins over selected focus and legacy focus stays selectable @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/map?scope=thing.webapp&focus=screen.people`);
  await scope(page, "thing.webapp");
  await expect(selection(page)).toContainText("People");
  await expect(inspector(page)).toHaveCount(0);
  await page.goto(`${SYSTEM}/map?focus=screen.people&inspect=1`);
  await scope(page, "screen.people");
  await expect(inspector(page)).toBeVisible();
  await expect(tile(page, "screen.people")).toHaveAttribute("data-selected", "true");
  await page.goto(`${SYSTEM}/things/thing.webapp/map`);
  await scope(page, "thing.webapp");
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await scope(page, SID);
  await expect(page).not.toHaveURL(/\/things\//);
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await scope(page, "environment");
});

test("selected boundary connections retain actual endpoint paths, labels, certainty and Locate @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  for (const node of model.nodes) node.links = [];
  model.nodes.find((node) => node.id === "policy.ownerOnly")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "assumed", label: "Owner consent" }];
  model.nodes.find((node) => node.id === "policy.authentication")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "declared", label: "Signed in" }];
  await mockApi(page, data);
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await scope(page, "thing.webapp");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await tile(page, "section.authorization").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await selection(page).getByRole("button", { name: "Connections (2)", exact: true }).click();
  const connections = page.getByRole("region", { name: "Selected connections" });
  await expect(connections.getByRole("listitem")).toHaveCount(2);
  await expect(connections).toContainText("Peopling / Peopling web app / Authorization / Owner-only access");
  await expect(connections).toContainText("Peopling / Peopling web app / UI / People");
  await expect(connections).toContainText("Owner consent · assumed");
  await expect(connections).toContainText("Signed in · declared");
  await connections.getByRole("button", { name: "Locate People", exact: true }).first().click();
  await scope(page, "section.ui");
  await expect(tile(page, "screen.people")).toHaveAttribute("data-selected", "true");
  await expect(inspector(page)).toHaveCount(0);
});

test("selection, Details, connection visibility and overlays preserve tile geometry and camera @fixture", async ({ page }, testInfo) => {
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await expect(tile(page, "section.ui")).toBeVisible();
  const initialGeometry = await geometry(page);
  const initialCamera = await camera(page);
  await checkA11yAndShoot(page, testInfo, "atlas-thing-mosaic");
  await tile(page, "section.ui").click();
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(await camera(page)).toBe(initialCamera);
  await page.getByRole("checkbox", { name: "Show all connections" }).check();
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(await camera(page)).toBe(initialCamera);
  for (const layer of ["Proteome", "Phenome", "Genome"]) {
    await page.getByRole("tab", { name: layer, exact: true }).click();
    expect(await geometry(page)).toEqual(initialGeometry);
    expect(await camera(page)).toBe(initialCamera);
  }
  await selection(page).getByRole("button", { name: "Details", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(await camera(page)).toBe(initialCamera);
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(await camera(page)).toBe(initialCamera);
});

test("keyboard and reduced motion provide explicit Enter, Up and Details paths @fixture", async ({ page }, testInfo) => {
  const waitForFrameFocus = async (id: string) => {
    // The entering tile may retain focus before the promised frame-focus callback runs.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeFocused();
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${SYSTEM}/map?scope=environment`);
  const system = page.locator(`.react-flow__node[data-id="${SID}"]`);
  await system.focus();
  await page.keyboard.press("Space");
  await expect(tile(page, SID)).toHaveAttribute("data-selected", "true");
  await expect(inspector(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await scope(page, SID);
  await waitForFrameFocus(SID);
  const thing = page.locator('.react-flow__node[data-id="thing.webapp"]');
  await thing.focus();
  await page.keyboard.press("Enter");
  await scope(page, "thing.webapp");
  await waitForFrameFocus("thing.webapp");
  const section = page.locator('.react-flow__node[data-id="section.ui"]');
  await section.focus();
  await expect(section).toBeFocused();
  await page.keyboard.press("d");
  await expect(inspector(page)).toBeVisible();
  await expect(inspector(page).getByRole("button", { name: "Copy id section.ui", exact: true })).toBeVisible();
  await scope(page, "thing.webapp");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await scope(page, SID);
  await checkA11yAndShoot(page, testInfo, "atlas-keyboard-reduced-motion");
});

test("ordinary wheel pans while modified wheel enters once per gesture and restores scope camera @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await expect(tile(page, SID).getByText("Peopling", { exact: true })).toBeInViewport();
  const point = await tilePoint(page, SID);
  await page.mouse.move(point.x, point.y);
  const initial = await camera(page);
  await page.mouse.wheel(0, 90);
  await expect.poll(() => camera(page)).not.toBe(initial);
  await scope(page, "environment");
  const panned = await camera(page);
  const next = await tilePoint(page, SID);
  await page.mouse.move(next.x, next.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -90);
  await scope(page, "environment");
  await page.mouse.wheel(0, -90);
  await scope(page, SID);
  await page.mouse.wheel(0, -600);
  await scope(page, SID);
  await page.keyboard.up("Control");
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await scope(page, "environment");
  await expect.poll(() => camera(page)).toBe(panned);
});

test("real browser touch pinch enters once and reverse pinch moves up @fixture", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, hasTouch: true, viewport: { width: 900, height: 700 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(`${SYSTEM}/map?scope=environment`);
    await expect(tile(page, SID)).toBeVisible();
    const session = await context.newCDPSession(page);
    await expect(tile(page, SID).getByText("Peopling", { exact: true })).toBeInViewport();
    const { x, y } = await tilePoint(page, SID);
    const points = (radius: number) => [{ x: x - radius, y, id: 1 }, { x: x + radius, y, id: 2 }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(30) });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(42) });
    await scope(page, SID);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(70) });
    await scope(page, SID);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(70) });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(40) });
    await scope(page, "environment");
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } finally { await context.close(); }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1024, height: 600 }]) {
  test(`atlas fits ${viewport.width}x${viewport.height} with reachable controls and Details @fixture`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`${SYSTEM}/map?scope=environment`);
    await expect(tile(page, SID)).toBeVisible();
    for (const name of ["Up", "Enter Peopling", "Tree", "Filters"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Phenome", exact: true })).toBeVisible();
    const box = (await canvas(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(220);
    expect(box.height).toBeGreaterThan(200);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    const effectiveNameSize = await tile(page, SID).getByText("Peopling", { exact: true }).evaluate((element) => {
      const viewport = element.closest(".react-flow__viewport")!;
      return parseFloat(getComputedStyle(element).fontSize) * new DOMMatrix(getComputedStyle(viewport).transform).a;
    });
    expect(effectiveNameSize, "System name must remain readable at the initial camera").toBeGreaterThanOrEqual(10);
    await checkA11yAndShoot(page, testInfo, `atlas-environment-${viewport.width}x${viewport.height}`);
    await page.getByRole("button", { name: "Enter Peopling", exact: true }).click();
    await scope(page, SID);
    await checkA11yAndShoot(page, testInfo, `atlas-system-mosaic-${viewport.width}x${viewport.height}`);
    await tile(page, "thing.webapp").click();
    await selection(page).getByRole("button", { name: "Enter Peopling web app", exact: true }).click();
    await scope(page, "thing.webapp");
    await checkA11yAndShoot(page, testInfo, `atlas-thing-mosaic-${viewport.width}x${viewport.height}`);
    await tile(page, "thing.webapp").getByText("Peopling web app", { exact: true }).click();
    await selection(page).getByRole("button", { name: "Details", exact: true }).click();
    await expect(inspector(page)).toBeVisible();
    await expect(inspector(page).getByRole("button", { name: /Close/ })).toBeVisible();
    await checkA11yAndShoot(page, testInfo, `atlas-details-${viewport.width}x${viewport.height}`);
  });
}

test("on-demand filters retain real containers and unfamiliar leaves stay inspectable @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  model.nodes.find((node) => node.id === "component.PeopleHeading")!.kind = "fixture-unfamiliar-kind";
  await mockApi(page, data);
  await page.goto(`${SYSTEM}/map?scope=${SID}`);
  await expect(page.getByRole("tree", { name: "Containment" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Layers shown" })).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  for (const checkbox of await page.getByRole("group", { name: "Layers shown" }).getByRole("checkbox").all()) await checkbox.uncheck();
  await expect(tile(page, "thing.webapp")).toBeVisible();
  await page.getByRole("button", { name: "Close map navigation" }).click();
  await tile(page, "thing.webapp").dblclick();
  await scope(page, "thing.webapp");
  await expect(tile(page, "section.ui")).toBeVisible();
  await expect(tile(page, "screen.people")).toHaveCount(0);
  await page.goto(`${SYSTEM}/map?scope=screen.people`);
  const leaf = tile(page, "component.PeopleHeading");
  await expect(leaf).toBeVisible();
  await leaf.dblclick();
  await scope(page, "screen.people");
  await page.locator('.react-flow__node[data-id="component.PeopleHeading"]').focus();
  await page.keyboard.press("Enter");
  await scope(page, "screen.people");
  await selection(page).getByRole("button", { name: "Details", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
  await expect(inspector(page)).toContainText("PageHeading");
});

test("offscreen selected connections remain discoverable through Locate @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  for (const node of model.nodes) node.links = [];
  model.nodes.find((node) => node.id === "policy.ownerOnly")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "declared" }];
  await mockApi(page, data);
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await tile(page, "section.ui").click();
  await expect(page.locator(".react-flow__edge").first()).toBeAttached();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width - 70, box.y + box.height / 2);
  await page.mouse.wheel(3200, 0);
  const indicators = page.locator('[aria-label="Offscreen connections"]');
  await expect(indicators.getByRole("button").first()).toBeVisible();
  await indicators.getByRole("button").first().click();
  await scope(page, "thing.webapp");
  const selected = page.locator("[data-map-node][data-selected]");
  await expect(selected).toHaveCount(1);
  await expect.poll(async () => {
    const tileBox = (await selected.boundingBox())!;
    return tileBox.x + tileBox.width > box.x && tileBox.x < box.x + box.width;
  }).toBe(true);
  await expect(inspector(page)).toHaveCount(0);
});

test("current scope selection exposes descendant links crossing its boundary @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  for (const node of model.nodes) node.links = [];
  model.nodes.find((node) => node.id === "screen.people")!.links = [{ rel: "serves", to: "ext.owner", direction: "out", certainty: "assumed", label: "Scope boundary evidence" }];
  // This relation stays inside the Thing and must not enter its boundary list.
  model.nodes.find((node) => node.id === "policy.ownerOnly")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "declared", label: "Internal only" }];
  await mockApi(page, data);
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await tile(page, "thing.webapp").getByText("Peopling web app", { exact: true }).click();
  const connectionButton = selection(page).getByRole("button", { name: /^Connections/ });
  await expect(connectionButton).toHaveText("Connections (1)");
  await connectionButton.click();
  const connections = page.getByRole("region", { name: "Selected connections" });
  await expect(connections.getByRole("listitem")).toHaveCount(1);
  await expect(connections).toContainText("Peopling / Peopling web app / UI / People");
  await expect(connections).toContainText("Scope boundary evidence · assumed");
  await expect(connections.getByRole("button", { name: "Locate Owner", exact: true })).toBeVisible();
  await expect(connections).not.toContainText("Internal only");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("Go to from explicit environment locates a deep target in its actual parent scope @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  await page.getByRole("button", { name: /^Go to/ }).click();
  const dialog = page.getByRole("dialog", { name: "Go to node" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("People");
  await dialog.getByRole("option", { name: /screen\.people/ }).first().click();
  await scope(page, "section.ui");
  await expect(tile(page, "screen.people")).toHaveAttribute("data-selected", "true");
  await expect(tile(page, "screen.people")).toBeInViewport();
  await expect(inspector(page)).toHaveCount(0);
  await page.goBack();
  await scope(page, "environment");
});

test("Tree Locate reveals a filtered same-scope leaf and centers its selection @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/map?scope=screen.people`);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByText("Kinds", { exact: true }).click();
  await page.getByRole("group", { name: "Kinds shown" }).getByRole("checkbox", { name: "Component", exact: true }).uncheck();
  await expect(tile(page, "component.PeopleHeading")).toHaveCount(0);
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await page.getByRole("tree", { name: "Containment" }).locator("#map-tree-component_PeopleHeading").click();
  await scope(page, "screen.people");
  await expect(tile(page, "component.PeopleHeading")).toHaveAttribute("data-selected", "true");
  await expect(tile(page, "component.PeopleHeading")).toBeInViewport({ ratio: 0.9 });
  expect(new URL(page.url()).searchParams.get("focus")).toBe("component.PeopleHeading");
  await expect(inspector(page)).toHaveCount(0);
});

test("Go to from another view overrides its remembered map scope @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/overview?scope=environment&layer=proteome`);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^Go to/ }).click();
  const dialog = page.getByRole("dialog", { name: "Go to node" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("People");
  await dialog.getByRole("option", { name: /screen\.people/ }).first().click();
  await scope(page, "section.ui");
  await expect(tile(page, "screen.people")).toHaveAttribute("data-selected", "true");
  await expect(tile(page, "screen.people")).toBeInViewport();
  expect(new URL(page.url()).searchParams.get("layer")).toBe("proteome");
  await expect(inspector(page)).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("scope")).toBe("environment");
});

test("browser Back restores a panned camera without replaying consumed Go to Locate @fixture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  await page.getByRole("button", { name: /^Go to/ }).click();
  const dialog = page.getByRole("dialog", { name: "Go to node" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("affordance.AddContactDialog.save");
  await dialog.getByRole("option", { name: /affordance\.AddContactDialog\.save/ }).click();
  await scope(page, "component.AddContactDialog");
  await expect(tile(page, "affordance.AddContactDialog.save")).toHaveAttribute("data-selected", "true");
  // Flush the completed reduced-motion Locate before creating a distinct user camera.
  await page.waitForTimeout(250);
  const located = await camera(page);
  const frame = (await canvas(page).boundingBox())!;
  await page.mouse.move(frame.x + frame.width * 0.65, frame.y + frame.height * 0.4);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => camera(page)).not.toBe(located);
  // The native wheel gesture releases after 150ms; its settled camera is the saved state.
  await page.waitForTimeout(250);
  const panned = await camera(page);
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await page.goBack();
  await scope(page, "component.AddContactDialog");
  // Let mount effects finish so an obsolete route Locate cannot pass transiently.
  await page.waitForTimeout(250);
  await expect.poll(() => camera(page)).toBe(panned);
  await expect(tile(page, "affordance.AddContactDialog.save")).toHaveAttribute("data-selected", "true");
  await expect(inspector(page)).toHaveCount(0);
});
