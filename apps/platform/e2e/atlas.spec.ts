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
/** Details narrows the pan area and may recentre the selection, so only the zoom is stable across it. */
const zoomOf = (transform: string | null) => /scale\(([\d.]+)\)/.exec(transform ?? "")?.[1];

async function waitAtlasReveals(page: Page) {
  // Audit settled surfaces only; ambient effects can animate indefinitely.
  await page.evaluate(async () => {
    // Route state and newly attached overlay refs commit before their layout-effect reveals.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const elements = [...document.querySelectorAll('[data-testid="atlas-surface"], [aria-label="Map selection"]')];
    await Promise.allSettled(elements.flatMap((element) => element.getAnimations().map((animation) => animation.finished)));
  });
}

/**
 * Wait until the camera holds still and reveals have finished. A tile clicked while the camera moves can receive the
 * mousedown but not the mouseup, so the click lands on the pane and nothing is selected.
 */
async function settle(page: Page) {
  await waitAtlasReveals(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const viewport = () => document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "";
    let last = viewport(), still = 0;
    const deadline = performance.now() + 5000;
    const tick = () => {
      const now = viewport();
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= 5) return resolve();
      if (performance.now() > deadline) return reject(new Error("the atlas camera never settled"));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}
/** Text inside a tile once the atlas has settled. */
const settledTile = async (page: Page, id: string) => { await settle(page); return tile(page, id); };

/**
 * Pan with the ordinary wheel, as a person would, until the tile has a visible point it owns, and return that point.
 * Without this, Playwright scrolls the overflow-hidden React Flow root to reach an offscreen tile, and that scroll can
 * snap back between mousedown and mouseup, so the click lands on another tile or the pane.
 */
async function revealTile(page: Page, id: string) {
  const frame = (await canvas(page).boundingBox())!;
  for (let step = 0; step < 24; step++) {
    await settle(page);
    const point = await pointOwnedBy(page, id);
    if (point) return point;
    const box = (await tile(page, id).boundingBox())!;
    const dx = box.x + Math.min(box.width / 2, 120) - (frame.x + frame.width / 2);
    const dy = box.y + Math.min(box.height / 2, 40) - (frame.y + frame.height / 2);
    const pane = await pointOwnedBy(page, null);
    expect(pane, "the canvas must expose pannable surface").not.toBeNull();
    await page.mouse.move(pane!.x, pane!.y);
    await page.mouse.wheel(dx, dy);
  }
  throw new Error(`${id} never came into view`);
}

/** The visible canvas point nearest its middle that hits the tile (or, for null, any tile or the pane), never a control. */
function pointOwnedBy(page: Page, id: string | null) {
  return page.evaluate((id) => {
    const frame = document.querySelector('[data-testid="atlas-canvas"]')!.getBoundingClientRect();
    const target = id ? document.querySelector(`[data-map-node="${id}"]`)!.getBoundingClientRect() : frame;
    const left = Math.max(target.left, frame.left), right = Math.min(target.right, frame.right);
    const top = Math.max(target.top, frame.top), bottom = Math.min(target.bottom, frame.bottom);
    const cx = (left + right) / 2, cy = (top + bottom) / 2, points: { x: number; y: number }[] = [];
    for (let x = left + 4; x < right - 4; x += 8) for (let y = top + 4; y < bottom - 4; y += 8) points.push({ x, y });
    points.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    return points.find(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit.closest("button, a, input, [role=dialog], aside")) return false;
      if (id) return hit.closest("[data-map-node]")?.getAttribute("data-map-node") === id;
      return !!hit.closest(".react-flow__pane, .react-flow__node");
    }) ?? null;
  }, id);
}

/** Click a tile the way a person would: bring it into view, then press a visible point it owns. */
async function pressTile(page: Page, id: string, action: "click" | "dblclick" = "click") {
  const point = await revealTile(page, id);
  await page.mouse[action](point.x, point.y);
}

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
  await pressTile(page, "thing.webapp");
  await scope(page, SID);
  await expect(inspector(page)).toHaveCount(0);
  await selection(page).getByRole("button", { name: "Enter Peopling web app", exact: true }).click();
  await scope(page, "thing.webapp");
  for (const id of ["section.ui", "section.domain", "section.authorization", "section.runtime"]) await expect(tile(page, id)).toBeVisible();
  await pressTile(page, "section.ui", "dblclick");
  await scope(page, "section.ui");
  await pressTile(page, "screen.people");
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

test("selected boundary connections retain actual endpoint paths, labels, certainty and Show on map @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  for (const node of model.nodes) node.links = [];
  model.nodes.find((node) => node.id === "policy.ownerOnly")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "assumed", label: "Owner consent" }];
  model.nodes.find((node) => node.id === "policy.authentication")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "declared", label: "Signed in" }];
  await mockApi(page, data);
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await scope(page, "thing.webapp");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await pressTile(page, "section.authorization");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await selection(page).getByRole("button", { name: "Connections (2)", exact: true }).click();
  const connections = page.getByRole("region", { name: "Selected connections" });
  await expect(connections.getByRole("listitem")).toHaveCount(2);
  await expect(connections).toContainText("Peopling / Peopling web app / Authorization / Owner-only access");
  await expect(connections).toContainText("Peopling / Peopling web app / UI / People");
  await expect(connections).toContainText("Owner consent, assumed");
  await expect(connections).toContainText("Signed in, declared");
  await connections.getByRole("button", { name: "Show People on map", exact: true }).first().click();
  await scope(page, "section.ui");
  await expect(tile(page, "screen.people")).toHaveAttribute("data-selected", "true");
  await expect(inspector(page)).toHaveCount(0);
});

test("selection, Details, connection visibility and overlays preserve tile geometry and camera @fixture", async ({ page }, testInfo) => {
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await revealTile(page, "section.ui");
  const initialGeometry = await geometry(page);
  const initialCamera = await camera(page);
  await checkA11yAndShoot(page, testInfo, "atlas-thing-mosaic");
  await pressTile(page, "section.ui");
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(await camera(page)).toBe(initialCamera);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("checkbox", { name: "All connections" }).check();
  await page.getByRole("button", { name: "Close map navigation" }).click();
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(await camera(page)).toBe(initialCamera);
  for (const layer of ["Proteome", "Phenome", "Genome"]) {
    await page.getByRole("tab", { name: layer, exact: true }).click();
    expect(await geometry(page)).toEqual(initialGeometry);
    expect(await camera(page)).toBe(initialCamera);
  }
  await selection(page).getByRole("button", { name: "Details", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
  await settle(page);
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(zoomOf(await camera(page))).toBe(zoomOf(initialCamera));
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  await settle(page);
  expect(await geometry(page)).toEqual(initialGeometry);
  expect(zoomOf(await camera(page))).toBe(zoomOf(initialCamera));
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
    await waitAtlasReveals(page);
    await checkA11yAndShoot(page, testInfo, `atlas-system-mosaic-${viewport.width}x${viewport.height}`);
    await pressTile(page, "thing.webapp");
    await selection(page).getByRole("button", { name: "Enter Peopling web app", exact: true }).click();
    await scope(page, "thing.webapp");
    await waitAtlasReveals(page);
    await checkA11yAndShoot(page, testInfo, `atlas-thing-mosaic-${viewport.width}x${viewport.height}`);
    await (await settledTile(page, "thing.webapp")).getByText("Peopling web app", { exact: true }).click();
    await expect(selection(page)).toBeVisible();
    await waitAtlasReveals(page);
    await checkA11yAndShoot(page, testInfo, `atlas-selection-${viewport.width}x${viewport.height}`);
    await selection(page).getByRole("button", { name: "Details", exact: true }).click();
    await expect(inspector(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
    await waitAtlasReveals(page);
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
  await pressTile(page, "thing.webapp", "dblclick");
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

test("offscreen selected connections remain discoverable through Show on map @fixture", async ({ page }) => {
  const data = defaultMockData();
  const model = data.bundles[SID]!.model as ModelJson;
  for (const node of model.nodes) node.links = [];
  model.nodes.find((node) => node.id === "policy.ownerOnly")!.links = [{ rel: "governs", to: "screen.people", direction: "out", certainty: "declared" }];
  await mockApi(page, data);
  await page.goto(`${SYSTEM}/map?scope=thing.webapp`);
  await pressTile(page, "section.ui");
  await expect(page.locator(".react-flow__edge").first()).toBeAttached();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width - 70, box.y + box.height / 2);
  await page.mouse.wheel(3200, 0);
  await page.getByRole("button", { name: /^Outside \(/ }).click();
  const indicators = page.getByRole("menu", { name: /^Outside / });
  await expect(indicators.getByRole("menuitem").first()).toBeVisible();
  await indicators.getByRole("menuitem").first().click();
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
  await (await settledTile(page, "thing.webapp")).getByText("Peopling web app", { exact: true }).click();
  const connectionButton = selection(page).getByRole("button", { name: /^Connections/ });
  await expect(connectionButton).toHaveText("Connections (1)");
  await connectionButton.click();
  const connections = page.getByRole("region", { name: "Selected connections" });
  await expect(connections.getByRole("listitem")).toHaveCount(1);
  await expect(connections).toContainText("Peopling / Peopling web app / UI / People");
  await expect(connections).toContainText("Scope boundary evidence, assumed");
  await expect(connections.getByRole("button", { name: "Show Owner on map", exact: true })).toBeVisible();
  await expect(connections).not.toContainText("Internal only");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("Go to from explicit environment locates a deep target in its actual parent scope @fixture", async ({ page }) => {
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  await page.getByRole("button", { name: /^Go to/ }).click();
  const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
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
  const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
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

test("browser Back restores a panned camera without replaying consumed Go to Show on map @fixture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  await page.getByRole("button", { name: /^Go to/ }).click();
  const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
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

type AtlasMotionRecord = { target: string; scope: string | null; duration: number; transformed: boolean; canceled: boolean; finished: boolean };
/**
 * Records atlas animations. `holdFirstScopeReveal` starts the first scope reveal paused, so a test can inspect or seek
 * it however busy the machine is; a 180 ms reveal can otherwise finish before the test reads it. The test resumes it.
 */
async function recordAtlasMotion(page: Page, { holdFirstScopeReveal = false } = {}) {
  await page.addInitScript((hold) => {
    const state = window as unknown as { __atlasMotion: AtlasMotionRecord[] };
    state.__atlasMotion = [];
    let held = !hold;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      const target = this.getAttribute("data-testid") === "atlas-surface" ? "scope" : this.getAttribute("aria-label");
      if (target === "scope" || target === "Map selection" || target === "Map navigation" || target === "Selected connections") {
        const record = { target, scope: this.closest("[data-scope]")?.getAttribute("data-scope") ?? null, duration: Number(animation.effect?.getTiming().duration), transformed: (animation.effect as KeyframeEffect).getKeyframes().some((frame) => frame.transform !== undefined), canceled: false, finished: false };
        state.__atlasMotion.push(record);
        animation.addEventListener("cancel", () => { record.canceled = true; });
        animation.addEventListener("finish", () => { record.finished = true; });
        if (target === "scope" && !held) { held = true; animation.pause(); }
      }
      return animation;
    };
  }, holdFirstScopeReveal);
}
const motions = (page: Page) => page.evaluate(() => (window as unknown as { __atlasMotion: AtlasMotionRecord[] }).__atlasMotion);
const scopeMotions = async (page: Page) => (await motions(page)).filter((record) => record.target === "scope");

test("scope reveal runs once while selection, Details and layer changes preserve the surface @fixture", async ({ page }, testInfo) => {
  await recordAtlasMotion(page, { holdFirstScopeReveal: true });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  expect(await scopeMotions(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Enter Peopling", exact: true }).click();
  await scope(page, SID);
  await expect.poll(() => scopeMotions(page)).toHaveLength(1);
  expect((await scopeMotions(page))[0]!.transformed).toBe(false);
  const surface = page.getByTestId("atlas-surface");
  await expect(surface).toHaveCSS("transform", "none");
  // Pause the actual browser animation at its midpoint for the requested transition-frame artifact.
  await surface.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error("Scope reveal finished before its transition frame was captured");
    animation.pause();
    animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
  });
  const framePath = testInfo.outputPath("atlas-normal-motion-frame.png");
  await page.screenshot({ path: framePath });
  await testInfo.attach("atlas-normal-motion-frame", { path: framePath, contentType: "image/png" });
  await surface.evaluate(async (element) => { const animation = element.getAnimations()[0]!; animation.play(); await animation.finished; });
  expect((await scopeMotions(page))[0]!.finished).toBe(true);
  await settle(page);
  const stableGeometry = await geometry(page), stableCamera = await camera(page);
  // Both selections are visible at the fitted camera, so no pan disturbs the camera under test.
  await pressTile(page, "GD.connect");
  await expect.poll(async () => (await motions(page)).filter((record) => record.target === "Map selection").length).toBe(1);
  await pressTile(page, SID);
  await page.getByRole("tab", { name: "Phenome", exact: true }).click();
  await selection(page).getByRole("button", { name: "Details", exact: true }).click();
  await expect(inspector(page)).toBeVisible();
  expect(await scopeMotions(page)).toHaveLength(1);
  expect((await motions(page)).filter((record) => record.target === "Map selection")).toHaveLength(1);
  await settle(page);
  expect(await geometry(page)).toEqual(stableGeometry);
  expect(zoomOf(await camera(page))).toBe(zoomOf(stableCamera));
});

test("interrupted depth cancels the old reveal and Effects toggling cannot replay it @fixture", async ({ page }) => {
  await recordAtlasMotion(page, { holdFirstScopeReveal: true });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  await page.getByRole("button", { name: "Enter Peopling", exact: true }).click();
  await scope(page, SID);
  await expect.poll(() => scopeMotions(page)).toHaveLength(1);
  await page.getByTestId("atlas-surface").evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error("the held scope reveal is missing");
    animation.currentTime = 60;
  });
  expect((await scopeMotions(page))[0]!.finished).toBe(false);
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await scope(page, "environment");
  await expect.poll(async () => (await scopeMotions(page))[0]?.canceled).toBe(true);
  await expect.poll(async () => (await scopeMotions(page)).filter((record) => record.finished).length).toBe(1);
  await expect(page.getByTestId("atlas-surface")).toHaveCSS("opacity", "1");
  const count = (await scopeMotions(page)).length;
  await page.getByRole("button", { name: /Effects/ }).click();
  await expect(page.getByRole("button", { name: /Effects/ })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Enter Peopling", exact: true }).click();
  await scope(page, SID);
  expect(await scopeMotions(page)).toHaveLength(count);
  await page.getByRole("button", { name: /Effects/ }).click();
  await expect(page.getByRole("button", { name: /Effects/ })).toHaveAttribute("aria-pressed", "true");
  expect(await scopeMotions(page)).toHaveLength(count);
  await page.goBack();
  await scope(page, "environment");
});

test("reduced motion suppresses scope and overlay reveals while preserving their actions @fixture", async ({ page }, testInfo) => {
  await recordAtlasMotion(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${SYSTEM}/map?scope=environment`);
  await scope(page, "environment");
  await page.getByRole("button", { name: "Enter Peopling", exact: true }).click();
  await scope(page, SID);
  await pressTile(page, "thing.webapp");
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await expect(page.getByRole("tree", { name: "Containment" })).toBeVisible();
  await page.getByRole("button", { name: "Close map navigation" }).click();
  await selection(page).getByRole("button", { name: /^Connections/ }).click();
  await expect(page.getByRole("region", { name: "Selected connections" })).toBeVisible();
  expect(await motions(page)).toHaveLength(0);
  expect(await page.getByTestId("atlas-surface").evaluate((element) => element.getAnimations().length)).toBe(0);
  await checkA11yAndShoot(page, testInfo, "atlas-polish-reduced-motion");
});

test("Details retains contrasting primary colors in normal and hover states @fixture", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${SYSTEM}/map?scope=thing.webapp&focus=section.ui`);
  await scope(page, "thing.webapp");
  const details = selection(page).getByRole("button", { name: "Details", exact: true });
  const tokenColors = await details.evaluate((element) => {
    const probe = document.createElement("span"), computed = getComputedStyle(element);
    probe.style.transition = "none";
    element.parentElement!.append(probe);
    const read = (name: string, property: "color" | "backgroundColor") => { probe.style[property] = computed.getPropertyValue(name); return getComputedStyle(probe)[property]; };
    const result = { color: read("--color-background", "color"), normal: read("--color-brand-primary", "backgroundColor"), hover: read("--color-brand-primary-hover", "backgroundColor"), active: read("--color-brand-primary-active", "backgroundColor") };
    probe.remove(); return result;
  });
  await expect(details).toHaveCSS("color", tokenColors.color);
  await expect(details).toHaveCSS("background-color", tokenColors.normal);
  await checkA11yAndShoot(page, testInfo, "atlas-details-normal-colors");
  await details.hover();
  await expect(details).toHaveCSS("color", tokenColors.color);
  await expect(details).toHaveCSS("background-color", tokenColors.hover);
  await checkA11yAndShoot(page, testInfo, "atlas-details-hover-colors");
  // The shared Button has no separate pressed fill; normal and hover are the contract.
});

test("candidate overlap link remains separate from Phenome and Proteome footer badges @fixture", async ({ page }, testInfo) => {
  const data = defaultMockData(), model = data.bundles[SID]!.model as ModelJson;
  const smallScope = "section.small-candidate-cells", subject = "component.small-a";
  const sectionTemplate = model.nodes.find((node) => node.id === "section.ui")!;
  const leafTemplate = model.nodes.find((node) => node.id === "component.PeopleHeading")!;
  model.nodes.push({ ...sectionTemplate, id: smallScope, name: "Small cells", description: "", links: [] });
  for (const letter of ["a", "b", "c", "d"]) model.nodes.push({ ...leafTemplate, id: `component.small-${letter}`, name: letter.toUpperCase(), description: letter === "a" ? "Small leaf with a short purpose." : "", parent: smallScope, links: [] });
  model.things[0]!.sections.push(smallScope);
  await mockApi(page, data);
  await page.route(`**/api/systems/${SID}/evolutions**`, async (route) => {
    const candidates = ["cand.a", "cand.b"].map((id) => ({ id, changedSubjects: [subject] }));
    const body = new URL(route.request().url()).pathname.endsWith("/candidates") ? { candidates } : { evolutions: [{ id: "evolution.overlap", affectedNodes: [subject] }], realizations: candidates.map((candidate, i) => ({ id: `realization.${i}`, candidate: candidate.id, evolution: "evolution.overlap", status: "pending" })) };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${SYSTEM}/map?scope=${smallScope}&focus=${subject}&candidates=cand.a,cand.b&layer=phenome`);
  await scope(page, smallScope);
  const unscaledWidth = await page.locator(`.react-flow__node[data-id="${subject}"]`).evaluate((element) => parseFloat((element as HTMLElement).style.width));
  expect(unscaledWidth).toBe(216);
  expect(await page.locator(`.react-flow__node[data-id="${subject}"]`).evaluate((element) => parseFloat((element as HTMLElement).style.height))).toBe(144);
  await expect(tile(page, subject).getByText("Small leaf with a short purpose.", { exact: true })).toBeVisible();
  testInfo.annotations.push({ type: "minimum-tile-width", description: `${unscaledWidth}px authored width` });
  const node = tile(page, subject), overlap = node.getByRole("link", { name: "Overlap, 2 candidates", exact: true });
  await expect(overlap).toBeVisible();
  const stableGeometry = await geometry(page);
  for (const layer of ["Phenome", "Proteome"] as const) {
    await page.getByRole("tab", { name: layer, exact: true }).click();
    const badges = layer === "Phenome" ? node.locator("[data-map-phenome]") : node.getByRole("img", { name: "2 realizations", exact: true });
    await expect(badges.first()).toBeVisible();
    const linkBox = (await overlap.boundingBox())!, nodeBox = (await node.boundingBox())!;
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(nodeBox.x + nodeBox.width + 1);
    expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(nodeBox.y + nodeBox.height + 1);
    for (const badge of await badges.all()) {
      const box = (await badge.boundingBox())!;
      expect(box.x + box.width <= linkBox.x || linkBox.x + linkBox.width <= box.x || box.y + box.height <= linkBox.y || linkBox.y + linkBox.height <= box.y, `${layer} counter must not overlap the candidate link`).toBe(true);
    }
    expect(await geometry(page)).toEqual(stableGeometry);
    await checkA11yAndShoot(page, testInfo, `atlas-candidate-footer-${layer.toLowerCase()}`);
    const smallCellPath = testInfo.outputPath(`atlas-small-cell-purpose-${layer.toLowerCase()}.png`);
    await node.screenshot({ path: smallCellPath });
    await testInfo.attach(`atlas-small-cell-purpose-${layer.toLowerCase()}`, { path: smallCellPath, contentType: "image/png" });
  }
});
