import { createServer, type Server } from "node:http";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { checkA11yAndShoot, successToneElements } from "./helpers";
import type { TestInfo } from "@playwright/test";

/** Helpers for the specs that run on the fake platform (`ARTYFACT_E2E_FAKE=1`). */
export const ADMIN_TOKEN = "test";
export const SYS = "system.keep-in-touch";
export const BASE = `/s/${SYS}/r/head`;
export const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };

/** Packet markdown code blocks scroll without a tab stop (axe scrollable-region-focusable); reported to the Work slice, excluded until fixed. */
export const PACKET_PRE = '[class*="markdown"] > pre';

/** Success tone is only for an assay `pass` (word or check glyph) and a build `passed`. */
export const isPass = (hit: string) => /✓|pass/i.test(hit);

/** Every visited page: nothing green except a passed build or pass verdict, and no serious axe violation. */
export async function checkPage(page: Page, testInfo: TestInfo, name: string, allowGreen: (hit: string) => boolean = isPass, exclude: string[] = []) {
  const green = (await successToneElements(page)).filter((h) => !allowGreen(h));
  expect(green).toEqual([]);
  await checkA11yAndShoot(page, testInfo, name, exclude);
}

/** Insert text at the end of the CodeMirror document that is currently shown. insertText skips the editor's auto-indent, which would shift YAML. */
export async function typeInEditor(page: Page, text: string) {
  const content = page.locator(".cm-content").first();
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(text);
}

/** A tiny HTTP app answering /health like a deployed preview, for the health assay (the platform allows localhost in fake mode). */
export async function startPreview(): Promise<{ url: string; setBuildId(id: string): void; close(): Promise<void> }> {
  let buildId = "";
  const server: Server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.url?.startsWith("/health") ? JSON.stringify({ status: "ok", buildId }) : "{}");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    setBuildId: (id) => (buildId = id),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

export async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`/api/systems/${SYS}${path}`);
  expect(res.ok(), `${path}: ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/**
 * The edit-and-realize loop through the UI: Inspector "Open in Code" on `section.runtime`, add a node under it as a new
 * node directory, commit it under a new Evolution, then Accept the amendment on Work. Returns the realization id.
 */
export async function editGenomeAndAccept(page: Page, testInfo: TestInfo, node: string, title: string): Promise<string> {
  // The editor's "New evolution…" cannot list affected nodes, and a Genome candidate may only touch the directories of
  // the Evolution's affected nodes, so the Evolution comes from Work with section.runtime (where bindings live).
  // A Genome amendment: its default acceptance criteria are the model ones (app criteria would block the accept).
  await createEvolution(page, title, `Add ${title} to the runtime.`, ["section.runtime"], ADMIN_TOKEN, BASE, "genome-amendment");
  await page.goto(`${BASE}/map?focus=section.runtime`);
  await page.getByRole("button", { name: "Open in Code" }).or(page.getByRole("link", { name: "Open in Code" })).first().click();
  await expect(page).toHaveURL(/\/code\?.*repo=genome/);
  await expect(page.getByRole("heading", { level: 1, name: "Code" })).toBeVisible();
  // The Inspector opens the section's own node.yaml; the new binding is a new node directory under it.
  await expect(page).toHaveURL(/path=thing\.webapp%2Fsection\.runtime%2Fnode\.yaml/);
  await page.getByRole("button", { name: "New file…" }).click();
  await page.getByLabel("New file path").fill(`thing.webapp/section.runtime/${node}/node.yaml`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await typeInEditor(page, `id: ${node}\nkind: binding\nfields:\n  name: ${title}\n  description: ${title} for the e2e run\n`);
  await checkPage(page, testInfo, `code-${node}`);
  await page.getByRole("link", { name: "Commit…" }).click();
  await page.getByLabel("Message").fill(`Add ${node}`);
  await page.getByRole("textbox", { name: "Why" }).fill(`The ${title} is needed.`);
  const evolution = page.getByLabel("Evolution", { exact: true });
  await evolution.selectOption((await evolution.locator("option", { hasText: title }).last().getAttribute("value")) ?? "");
  await page.getByLabel("Your name").fill("E2E");
  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Commit", exact: true }).click();

  await expect(page).toHaveURL(/\/work\?.*realization=/);
  const rid = new URL(page.url()).searchParams.get("realization")!;
  const row = page.getByTestId(`realization-${rid}`);
  await expect(row.locator("[data-status]").filter({ hasText: "awaiting-admin" })).toBeVisible();
  // The commit lands on a deep link to the realization, which opens its review.
  await expect(page.getByRole("region", { name: `Review ${rid}` })).toBeVisible();
  // The review re-renders when its evaluations arrive, which can reset the selected tab: select Amendment until its form shows.
  const interpretation = page.getByRole("textbox", { name: "Accepted interpretation" });
  await expect(async () => {
    await page.getByRole("tab", { name: "Amendment" }).click();
    await expect(interpretation).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  // The amendment's "benign class" confidence row is painted in the pass tone although it is a model judgement, not an assay pass.
  // Reported to the Work slice; tolerated here until it is neutral.
  await checkPage(page, testInfo, `amendment-${node}`, (h) => isPass(h) || /classRow|_num_|deliberate non-standard choice/.test(h));
  await interpretation.fill(`The ${title} is part of the runtime.`);
  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Accept amendment" }).click();
  await expect(page.getByText(/Accepted\. New Genome commit/)).toBeVisible();
  return rid;
}

/** Work "+ Evolution": fill the form and create it; the new card is selected afterwards. */
export async function createEvolution(page: Page, title: string, intent: string, nodes: string[] = [], token = ADMIN_TOKEN, base = BASE, kind?: string): Promise<void> {
  await page.goto(`${base}/work`);
  await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
  await page.getByRole("button", { name: "+ Evolution" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Intent").fill(intent);
  for (const n of nodes) {
    await page.getByLabel("Affected nodes").fill(n);
    await page.getByRole("button", { name: "Add node" }).click();
  }
  if (kind) await page.getByLabel("Kind").selectOption(kind);
  // An untouched list lets the server default the criteria, and hard ones gate Accept; these flows only edit the Genome, so send none.
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByLabel("Admin token").fill(token);
  await page.getByRole("button", { name: "Create Evolution" }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

/** Every System view renders at `base` (a `/s/<id>/r/head` path) with its heading, no console error and no uncaught exception. */
export async function sweepViews(page: Page, testInfo: TestInfo, base: string, tag: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  const views: [string, string][] = [
    ["overview", "Overview"], ["map", "Map"], ["journeys", "Journeys"], ["theory", "Theory"], ["code", "Code"],
    ["work", "Work"], ["review", "Review"], ["evaluations", "Evaluations"], ["changelog", "Changelog"], ["compare", "Compare"], ["phenome", "Deployments"],
  ];
  for (const [path, heading] of views) {
    await page.goto(`${base}/${path}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("fixture data")).toHaveCount(0);
    await checkPage(page, testInfo, `${tag}-${path}`, isPass, [PACKET_PRE, '[data-op] > [class*="num"]']);
  }
  expect(errors).toEqual([]);
}
