import "./testing/flowEnv";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CandidatesResponse, EvolutionsResponse } from "../../../shared/api";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const MAP = "/s/system.peopling/r/head/map";
const SYS = "system.peopling";
const nodeEl = (id: string) => document.querySelector(`[data-map-node="${id}"]`);
const flowNode = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
/** React Flow places every node (children included) at its absolute flow position via `transform`. */
const box = (id: string) => {
  const el = flowNode(id)!;
  const [, x, y] = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)!;
  return { x: +x!, y: +y!, w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
};
const ready = (id: string) => waitFor(() => expect(nodeEl(id)).not.toBeNull(), { timeout: 4000 });

describe("System atlas", () => {
  it("starts in the environment and offers navigation on demand", async () => {
    const { router } = renderApp(MAP);
    await ready(SYS);
    expect(screen.getByRole("navigation", { name: "Map scope" }).textContent).toContain("Environment");
    expect(nodeEl("ext.owner")).not.toBeNull();
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryByText("Node kinds")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(await screen.findByRole("tree", { name: "Containment" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enter Peopling" }));
    await waitFor(() => expect(router.state.location.search).toContain("scope=system.peopling"));
  });

  it("keeps the native camera finite through animated Locate and an interrupting wheel", async () => {
    renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContactDialog");
    const measuredPane = document.querySelector<HTMLElement>(".react-flow__renderer")!;
    expect(measuredPane.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(measuredPane.getBoundingClientRect().height).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    const row = within(screen.getByRole("tree", { name: "Containment" })).getAllByRole("treeitem").find(el => el.textContent?.includes("AddContactDialog"))!;
    fireEvent.click(row);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const renderer = document.querySelector<HTMLElement>(".react-flow__renderer")! as HTMLElement & { __zoom: { x: number; y: number; k: number } };
    // Exercise the native d3 transform, which CSS may silently reject when it is nonfinite.
    expect([renderer.__zoom.x, renderer.__zoom.y, renderer.__zoom.k].every(Number.isFinite)).toBe(true);
    const before = document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    fireEvent.wheel(document.querySelector(".react-flow__pane")!, { deltaY: 180 });
    await waitFor(() => expect(document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform).not.toBe(before));
    expect([renderer.__zoom.x, renderer.__zoom.y, renderer.__zoom.k].every(Number.isFinite)).toBe(true);
  });

  it("selects without Details and keeps scope and tile geometry across overlays", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContact");
    const before = box("component.AddContact");
    fireEvent.click(nodeEl("component.AddContact")!);
    await waitFor(() => expect(router.state.location.search).toContain("focus=component.AddContact"));
    expect(router.state.location.search).toContain("scope=screen.people");
    expect(router.state.location.search).not.toContain("inspect");
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await waitFor(() => expect(router.state.location.search).toContain("inspect=1"));
    expect(box("component.AddContact")).toEqual(before);
    await act(() => router.navigate(`${MAP}?scope=screen.people&focus=component.AddContact&layer=phenome`));
    expect(box("component.AddContact")).toEqual(before);
  });

  it("enters containers, ignores leaf zoom, and goes up explicitly or by keyboard", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContactDialog");
    fireEvent.doubleClick(nodeEl("component.AddContactDialog")!);
    await waitFor(() => expect(router.state.location.search).toContain("scope=component.AddContactDialog"));
    await ready("affordance.AddContactDialog.save");
    fireEvent.doubleClick(nodeEl("affordance.AddContactDialog.save")!);
    expect(router.state.location.search).toContain("scope=component.AddContactDialog");
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    await waitFor(() => expect(router.state.location.search).toContain("scope=screen.people"));
    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => expect(router.state.location.search).toContain("scope=section.ui"));
  });

  it("enters after the real click-click-doubleclick selection sequence commits its URL", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContactDialog");
    const node = nodeEl("component.AddContactDialog")!;
    await act(async () => {
      fireEvent.click(node, { detail: 1 });
      fireEvent.click(node, { detail: 2 });
      fireEvent.doubleClick(node, { detail: 2 });
    });
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("scope")).toBe("component.AddContactDialog"));
    await ready("affordance.AddContactDialog.save");
  });

  it("cancels double-click Enter when a newer unrelated URL supersedes its selecting click", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContactDialog");
    const node = nodeEl("component.AddContactDialog")!;
    await act(async () => {
      fireEvent.click(node, { detail: 1 });
      fireEvent.click(node, { detail: 2 });
      fireEvent.doubleClick(node, { detail: 2 });
      await router.navigate(`${MAP}?scope=screen.people&focus=component.ContactCollection`);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("scope")).toBe("screen.people");
    expect(params.get("focus")).toBe("component.ContactCollection");
  });

  it("reveals selected connections and retains original endpoint paths with Locate", async () => {
    renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContactDialog");
    expect(document.querySelectorAll("[data-edge-type]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show all connections" }));
    await waitFor(() => expect(document.querySelectorAll("[data-edge-type]").length).toBeGreaterThan(0));
    fireEvent.click(nodeEl("component.AddContactDialog")!);
    fireEvent.click(screen.getByRole("button", { name: /Connections \(/ }));
    expect(screen.getByRole("region", { name: "Selected connections" }).textContent).toContain("Peopling");
    expect(screen.getAllByRole("button", { name: /^Locate / }).length).toBeGreaterThan(0);
  });

  it("selected scope lists descendant boundary endpoints with outside context discovery", async () => {
    renderApp(`${MAP}?scope=screen.people&focus=screen.people`);
    await ready("component.ContactCollection");
    fireEvent.click(screen.getByRole("button", { name: /Connections \(/ }));
    const list = screen.getByRole("region", { name: "Selected connections" });
    expect(within(list).getAllByRole("button", { name: "Locate ContactRecord" }).length).toBeGreaterThan(0);
    expect(within(list).getAllByRole("button", { name: "Locate Create or edit private contact" }).length).toBeGreaterThan(0);
    const canvas = screen.getByTestId("atlas-canvas");
    const renderer = document.querySelector<HTMLElement>(".react-flow__renderer")! as HTMLElement & { __zoom: { x: number; y: number; k: number } };
    const record = box("entity.ContactRecord");
    // Scope cameras survive remounts. Deliberately move this endpoint beyond the measured
    // viewport rather than assuming two zoom clicks hide it from every saved camera.
    const shift = canvas.offsetWidth + 32 - (record.x * renderer.__zoom.k + renderer.__zoom.x);
    fireEvent.wheel(document.querySelector(".react-flow__pane")!, { deltaX: -shift / 0.5, deltaY: 0 });
    expect(record.x * renderer.__zoom.k + renderer.__zoom.x).toBeGreaterThan(canvas.offsetWidth);
    await waitFor(() => expect(within(screen.getByLabelText("Offscreen connections")).getByRole("button", { name: "Locate ContactRecord" })).toBeTruthy());
  });

  it('Tree Locate selects a direct child hidden by a filter without changing scope', async () => {
  const { router } = renderApp(`${MAP}?scope=screen.people`);
  await waitFor(() => expect(nodeEl('component.AddContactDialog')).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  const kinds = screen.getByRole('group', { name: 'Kinds shown' });
  const checkbox = within(kinds).getByRole('checkbox', { name: /Component/ });
  fireEvent.click(checkbox);
  await waitFor(() => expect(nodeEl('component.AddContactDialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  const tree = screen.getByRole('tree', { name: 'Containment' });
  const row = within(tree).getAllByRole('treeitem').find(el => el.textContent?.includes('AddContactDialog'))!;
  const before = document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
  fireEvent.click(row);
  await waitFor(() => expect(nodeEl('component.AddContactDialog')).not.toBeNull());
  expect(new URLSearchParams(router.state.location.search).get('focus')).toBe('component.AddContactDialog');
  expect(new URLSearchParams(router.state.location.search).get('scope')).toBe('screen.people');
  expect(router.state.historyAction).toBe('REPLACE');
  await waitFor(() => expect(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform).not.toBe(before));
});


  it('does not replay consumed palette Locate after leaving Map and going Back to a panned scope', async () => {
  const { router } = renderApp(`${MAP}?scope=environment`);
  await waitFor(() => expect(nodeEl('system.peopling')).not.toBeNull());
  await act(async () => void fireEvent.keyDown(window, { key: 'k', metaKey: true }));
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByRole('combobox');
  await act(async () => void fireEvent.change(input, { target: { value: 'AddContactDialog.save' } }));
  await waitFor(() => expect(within(dialog).getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true'));
  await act(async () => void fireEvent.keyDown(input, { key: 'Enter' }));
  await waitFor(() => expect(nodeEl('affordance.AddContactDialog.save')).not.toBeNull());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  const viewport = () => document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
  const initial = viewport();
  fireEvent.wheel(document.querySelector('.react-flow__pane')!, { deltaY: 180 });
  await waitFor(() => expect(viewport()).not.toBe(initial));
  const panned = viewport();
  fireEvent.click(screen.getByRole('link', { name: 'Overview' }));
  await screen.findByRole('heading', { name: 'Overview', level: 1 });
  await act(() => router.navigate(-1));
  await waitFor(() => expect(nodeEl('affordance.AddContactDialog.save')).not.toBeNull());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  expect(viewport()).toBe(panned);
  expect(router.state.historyAction).toBe("POP");
  expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("affordance.AddContactDialog.save");
});

  it("restores a camera changed by a single ordinary-wheel tick after Enter and Up", async () => {
    renderApp(MAP);
    await ready(SYS);
    const viewport = () => document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const initial = viewport();
    fireEvent.wheel(document.querySelector(".react-flow__pane")!, { deltaY: 90 });
    await waitFor(() => expect(viewport()).not.toBe(initial));
    const panned = viewport();
    fireEvent.click(screen.getByRole("button", { name: "Enter Peopling" }));
    await ready("thing.webapp");
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    await waitFor(() => expect(viewport()).toBe(panned));
  });

  it("Locate reveals the actual endpoint in its immediate parent scope", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people&focus=component.AddContactDialog`);
    await ready("component.AddContactDialog");
    fireEvent.click(screen.getByRole("button", { name: /Connections \(/ }));
    const list = screen.getByRole("region", { name: "Selected connections" });
    const target = within(list).getAllByRole("button", { name: /^Locate / })[0]!;
    fireEvent.click(target);
    await waitFor(() => expect(router.state.location.search).not.toContain("scope=screen.people"));
    const selected = new URLSearchParams(router.state.location.search).get("focus")!;
    await ready(selected);
    expect(flowNode(selected)?.getAttribute("aria-label")).toBeTruthy();
  });

  it("restores the panned camera after a cross-scope connected Locate leaves Map and goes Back", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people&focus=component.AddContactDialog`);
    await ready("component.AddContactDialog");
    fireEvent.click(screen.getByRole("button", { name: /Connections \(/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected connections" })).getAllByRole("button", { name: /^Locate / })[0]!);
    await ready("affordance.AddContactDialog.save");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    const viewport = () => document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const initial = viewport();
    fireEvent.wheel(document.querySelector(".react-flow__pane")!, { deltaY: 180 });
    await waitFor(() => expect(viewport()).not.toBe(initial));
    const panned = viewport();
    fireEvent.click(screen.getByRole("link", { name: /^Overview$/ }));
    await screen.findByRole("heading", { name: "Overview", level: 1 });
    await act(() => router.navigate(-1));
    await ready("affordance.AddContactDialog.save");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(viewport()).toBe(panned);
    expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("affordance.AddContactDialog.save");
  });

  it("does not commit cross-scope Locate after a newer same-scope URL selection", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people&focus=component.AddContactDialog`);
    await ready("component.AddContactDialog");
    fireEvent.click(screen.getByRole("button", { name: /Connections \(/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected connections" })).getAllByRole("button", { name: /^Locate / })[0]!);
    await act(() => router.navigate(`${MAP}?scope=screen.people&focus=component.ContactCollection`));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get("scope")).toBe("screen.people");
    expect(params.get("focus")).toBe("component.ContactCollection");
  });

  it("does not replay an abandoned connected Locate after unrelated navigation reaches its old destination", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people&focus=component.AddContactDialog`);
    await ready("component.AddContactDialog");
    fireEvent.click(screen.getByRole("button", { name: /Connections \(/ }));
    const region = screen.getByRole("region", { name: "Selected connections" });
    fireEvent.click(within(region).getAllByRole("button", { name: /^Locate / })[0]!);
    // Leave before the approach commits; a later visit must obey the new URL selection.
    await act(() => router.navigate(`${MAP}?scope=component.AddContactDialog&focus=affordance.AddContactDialog.cancel`));
    await ready("affordance.AddContactDialog.cancel");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("affordance.AddContactDialog.cancel");
  });

  it("keyboard Enter enters a container and keeps focus on its new scope frame", async () => {
    renderApp(`${MAP}?scope=screen.people`);
    await ready("component.AddContactDialog");
    flowNode("component.AddContactDialog")!.focus();
    fireEvent.keyDown(flowNode("component.AddContactDialog")!, { key: "Enter" });
    await ready("affordance.AddContactDialog.save");
    await waitFor(() => expect(document.activeElement).toBe(flowNode("component.AddContactDialog")));
  });

  it("ordinary wheel pans while modified wheel and actual pinch navigate once per gesture", async () => {
    const { router } = renderApp(`${MAP}?scope=screen.people&focus=component.AddContactDialog`);
    await ready("component.AddContactDialog");
    const canvas = screen.getByTestId("atlas-canvas");
    fireEvent.wheel(canvas, { deltaY: -300 });
    expect(router.state.location.search).toContain("scope=screen.people");
    fireEvent.wheel(canvas, { deltaY: -160, ctrlKey: true });
    fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true });
    fireEvent.wheel(canvas, { deltaY: -80, ctrlKey: true });
    await waitFor(() => expect(router.state.location.search).toContain("scope=component.AddContactDialog"));
    fireEvent.wheel(canvas, { deltaY: 300, ctrlKey: true });
    expect(router.state.location.search).toContain("scope=component.AddContactDialog");
    fireEvent.touchStart(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
    fireEvent.touchMove(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 65, clientY: 0 }] });
    await waitFor(() => expect(router.state.location.search).toContain("scope=screen.people"));
    fireEvent.touchMove(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 20, clientY: 0 }] });
    expect(router.state.location.search).toContain("scope=screen.people");
    fireEvent.touchEnd(canvas, { touches: [] });
  });
});

describe("Candidate overlay", () => {
  it("brackets touched nodes and marks overlap where two candidates meet", async () => {
    const seed = (qc: Parameters<NonNullable<Parameters<typeof renderApp>[2]>>[0]) => {
      const board = {
        evolutions: [{ id: "evolution.x", affectedNodes: ["screen.people"], realizations: [] }],
        realizations: [
          { id: "realization.a", evolution: "evolution.x", candidate: "cand.a" },
          { id: "realization.b", evolution: "evolution.x", candidate: "cand.b" },
        ],
      } as unknown as EvolutionsResponse;
      const cands = {
        evolution: "evolution.x",
        candidates: [
          { id: "cand.a", changedSubjects: ["affordance.AddContactDialog.save", "entity.ContactRecord", "unmapped:src/x.ts"] },
          { id: "cand.b", changedSubjects: ["component.AddContactNameField"] },
        ],
        evaluations: [],
        conflicts: [],
      } as unknown as CandidatesResponse;
      qc.setQueryData(qk.evolutions(SYS), board);
      qc.setQueryData(qk.candidates(SYS, "evolution.x"), cands);
    };
    renderApp(`${MAP}?focus=screen.people&candidates=cand.a,cand.b`, undefined, seed);
    await ready("component.AddContactDialog");
    await waitFor(() => expect(within(nodeEl("component.AddContactDialog") as HTMLElement).getByText("overlap · 2")).toBeTruthy());
    // The chip is a way into Review with both candidates preselected for composition.
    const chip = within(nodeEl("component.AddContactDialog") as HTMLElement).getByRole("link", { name: "overlap · 2" });
    expect(new URLSearchParams(chip.getAttribute("href")!.split("?")[1]).get("candidates")).toBe("cand.a,cand.b");
    expect(chip.getAttribute("href")).toContain("/review?");
    expect(flowNode("component.AddContactDialog")!.getAttribute("aria-label")).toContain("touched by cand.a and cand.b (overlap)");
    const record = nodeEl("entity.ContactRecord") as HTMLElement;
    expect(within(record).queryByText(/overlap/)).toBeNull();
    expect(within(record).getByText("Touched by cand.a")).toBeTruthy();
    expect(within(nodeEl("component.SearchInput") as HTMLElement).queryByText(/Touched by/)).toBeNull();
  });
});

describe("HierarchyTree", () => {
  it("navigates with the keyboard and selects with Enter", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    fireEvent.click(await screen.findByRole("button", { name: "Tree" }));
    const tree = await screen.findByRole("tree", { name: "Containment" });
    const active = () => document.getElementById(tree.getAttribute("aria-activedescendant")!)!;
    expect(active().textContent).toContain("People");
    expect(active().getAttribute("aria-selected")).toBe("true");
    // the scope starts expanded: ← collapses, → expands, → again enters the first child
    expect(active().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(active().getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(active().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(active().textContent).toContain("AddContact");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    const second = active().textContent;
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    expect(active().textContent).not.toBe(second);
    // ← on a leaf goes to the parent; ← again collapses
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(active().textContent).toContain("People");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(active().getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    fireEvent.keyDown(tree, { key: "Enter" });
    await waitFor(() => expect(router.state.location.search).not.toContain("focus=screen.people"));
    expect(router.state.location.search).toMatch(/focus=screen\./);
  });

  it("windows rows: only a slice of a long tree is in the DOM", async () => {
    renderApp(`${MAP}?focus=component.AddContactNameField`);
    fireEvent.click(await screen.findByRole("button", { name: "Tree" }));
    const tree = await screen.findByRole("tree", { name: "Containment" });
    const rendered = within(tree).getAllByRole("treeitem").length;
    const total = Number((tree.firstElementChild as HTMLElement).style.height.replace("px", "")) / 28;
    expect(rendered).toBeLessThanOrEqual(total);
    expect(rendered).toBeLessThan(60);
  });
});

describe("fitViewport", () => {
  it("centres the graph and caps the zoom", async () => {
    const { fitViewport } = await import("./MapView");
    const v = fitViewport(1000, 200, 800, 600);
    expect(v.zoom).toBeCloseTo(800 / (1000 * 1.24));
    expect(v.x).toBeCloseTo((800 - 1000 * v.zoom) / 2);
    expect(fitViewport(100, 100, 800, 600).zoom).toBe(1.1);
  });
});
