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
 * The edit-and-realize loop through the UI: Inspector "Open in Code" on `screen.people`, add a node to the Thing's
 * ontology, commit it under a new Evolution, then Accept the amendment on Work. Returns the realization id.
 */
export async function editGenomeAndAccept(page: Page, testInfo: TestInfo, node: string, title: string): Promise<string> {
  // The editor's "New evolution…" cannot list affected nodes, and a Genome candidate may only touch the files of the
  // Evolution's affected nodes, so the Evolution comes from Work with screen.people (defined in the Thing's ontology).
  // A Genome amendment: its default acceptance criteria are the model ones (app criteria would block the accept).
  await createEvolution(page, title, `Add ${title} to the runtime.`, ["screen.people"], ADMIN_TOKEN, BASE, "genome-amendment");
  await page.goto(`${BASE}/map?focus=screen.people`);
  await page.getByRole("button", { name: "Open in Code" }).or(page.getByRole("link", { name: "Open in Code" })).first().click();
  await expect(page).toHaveURL(/\/code\?.*repo=genome/);
  await expect(page.getByRole("heading", { level: 1, name: "Code" })).toBeVisible();
  // The Inspector links the node's source document id, which is not a file; pick the Thing's ontology in the tree.
  await page.getByLabel("Filter files").fill("webapp/ontology");
  await page.getByRole("link", { name: "ontology.yaml" }).click();
  await expect(page).toHaveURL(/path=things%2Fwebapp%2Fontology\.yaml/);
  await page.getByRole("button", { name: "Edit" }).click();
  await typeInEditor(page, `  - { id: ${node}, kind: binding, name: ${title}, parent: section.runtime, description: ${title} for the e2e run }\n`);
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
  await page.getByRole("tab", { name: "Amendment" }).click();
  const interpretation = page.getByRole("textbox", { name: "Accepted interpretation" });
  await expect(interpretation).toBeVisible();
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
  await page.getByLabel("Admin token").fill(token);
  await page.getByRole("button", { name: "Create Evolution" }).click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}
