import "@/views/map/testing/flowEnv";
import { join } from "node:path";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { qk } from "@/api/queries";
import { kindViews } from "@/model/kinds";
import { bundleFromGenomeTree } from "@/testing/genomeTree";
import { renderApp } from "@/testing/render";

// W3's dev-platform Genome: Workers, a library, a CLI and a static site. No screens, components or entities.
const GENOME = join(import.meta.dirname, "../../../../packages/templates/test/fixtures/dev-platform/genome");
const bundle = bundleFromGenomeTree(GENOME);
const SYS = bundle.systemId;
const at = (view: string, query = "") => `/s/${SYS}/r/head/${view}${query}`;
const seed = (qc: Parameters<NonNullable<Parameters<typeof renderApp>[2]>>[0]) => qc.setQueryData(qk.model(SYS, "head"), bundle);

/** Renders `url` and fails on any console error (React render errors are logged there). */
async function renderClean(url: string) {
  const errors = vi.spyOn(console, "error");
  const result = renderApp(url, undefined, seed);
  await screen.findByRole("heading", { level: 1 });
  expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([]);
  return result;
}

describe("a System whose templates have other kinds than the webapp's", () => {
  it("has no screen nodes and resolves its kinds from its templates", () => {
    expect(bundle.model.nodes.map((n) => n.kind)).not.toContain("screen");
    const views = kindViews(bundle.model);
    expect(views.of("endpoint")).toMatchObject({ label: "Endpoint", glyph: "/", colour: "blue", layer: "experience" });
    expect(views.of("durable-object")).toMatchObject({ label: "Durable Object", plural: "Durable Objects", glyph: "DO" });
    expect(views.layers.map((l) => l.id)).toContain("runtime");
  });

  it("renders Home", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url) === "/api/systems"
        ? new Response(JSON.stringify({ systems: [{ systemId: SYS, title: "Toolkit", head: "sc-1", genomeRepo: "g", appRepo: "a", genomeCommit: "0".repeat(40), phase: "unrealized", evolutionCounts: {}, updatedAt: new Date().toISOString() }] }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 404 })));
    renderApp("/");
    expect(await screen.findByRole("link", { name: /^Toolkit$/ })).toBeTruthy();
  });

  it("renders Overview", async () => {
    await renderClean(at("overview"));
    expect((await screen.findByRole("heading", { level: 1, name: "Toolkit" })).id).toBe("view-title");
    expect(screen.getByText(/Operators submit a job once and see it finish/)).toBeTruthy();
    expect(screen.getAllByText("purpose.reliable-jobs").length).toBeGreaterThan(0);
  });

  it("keeps real containment levels and displays template-only kind labels and glyphs", async () => {
    const { router } = await renderClean(at("map"));
    await waitFor(() => expect(document.querySelector('[data-map-node="system.toolkit"]')).not.toBeNull());
    expect(document.querySelector('[data-map-node="endpoint.submit"]')).toBeNull();
    await act(() => router.navigate(at("map", "?scope=system.toolkit")));
    expect(document.querySelector('[data-map-node="thing.api"]')).not.toBeNull();
    expect(document.querySelector('[data-map-node="section.purpose"]')).not.toBeNull();
    expect(document.querySelector('[data-map-node="endpoint.submit"]')).toBeNull();
    await act(() => router.navigate(at("map", "?scope=thing.api")));
    expect(document.querySelector('[data-map-node="thing.api.runtime"]')).not.toBeNull();
    expect(document.querySelector('[data-map-node="durable-object.counter"]')).toBeNull();
    await act(() => router.navigate(at("map", "?scope=thing.api.runtime")));
    const node = document.querySelector<HTMLElement>('[data-map-node="durable-object.counter"]')!;
    expect(within(node).getByText("DO")).toBeTruthy();
    expect(within(node).getByText("Durable Object")).toBeTruthy();
    await act(() => screen.getByRole("button", { name: /^Tree$/ }).click());
    const tree = screen.getByRole("tree", { name: "Containment" });
    expect(within(tree).getAllByText(", Thing").length).toBe(4);
    expect(within(tree).getAllByText(", Purpose").length).toBe(1);
    expect(within(tree).queryAllByText(/Unknown/)).toEqual([]);
  });

  it("renders Work", async () => {
    await renderClean(at("work"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Work/);
  });

  it("opens a node of a template-only kind in the Inspector with its hint fields in order", async () => {
    await renderClean(at("overview", "?focus=endpoint.submit"));
    const box = await screen.findByRole("complementary", { name: "Inspector" });
    expect(within(box).getByText("Endpoint")).toBeTruthy();
    const keys = within(box).getAllByRole("term").map((t) => t.textContent);
    expect(keys).toEqual(["Route", "Auth"]);
  });
});
