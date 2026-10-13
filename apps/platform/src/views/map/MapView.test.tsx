import "./testing/flowEnv";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CandidatesResponse, EvolutionsResponse } from "../../../shared/api";
import { qk } from "@/api/queries";
import * as elk from "@/graph/elk";
import { renderApp } from "@/testing/render";

const MAP = "/s/system.keep-in-touch/r/head/map";
const SYS = "system.keep-in-touch";
const nodeEl = (id: string) => document.querySelector(`[data-map-node="${id}"]`);
const flowNode = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
const crumbs = () => within(screen.getByRole("navigation", { name: "Map scope" })).getAllByRole("listitem");
/** React Flow places every node (children included) at its absolute flow position via `transform`. */
const box = (id: string) => {
  const el = flowNode(id)!;
  const [, x, y] = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)!;
  return { x: +x!, y: +y!, w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
};
const ready = (id: string) => waitFor(() => expect(nodeEl(id)).not.toBeNull(), { timeout: 4000 });

describe("Map view", () => {
  it("deep link: breadcrumbs, nested components and grey not-run phenome badges", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people&layer=phenome`);
    const crumbs = await screen.findByRole("navigation", { name: "Map scope" });
    expect(within(crumbs).getAllByRole("listitem").map((li) => li.textContent?.replace(/^\//, "").replace(/, \w+$/, ""))).toEqual([
      "Keep in Touch",
      "Keep in Touch web app",
      "UI",
      "People",
    ].map((s) => expect.stringContaining(s)) as unknown as string[]);
    await waitFor(() => expect(nodeEl("component.SearchInput")).not.toBeNull(), { timeout: 4000 });
    // children are nested: each child's box lies inside the scope group's box
    expect(nodeEl("screen.people")?.getAttribute("data-role")).toBe("scope");
    const group = box("screen.people");
    for (const id of ["component.SearchInput", "component.AddContactDialog", "component.ContactCollection"]) {
      const c = box(id);
      expect(c.x, id).toBeGreaterThanOrEqual(group.x);
      expect(c.y, id).toBeGreaterThan(group.y);
      expect(c.x + c.w, id).toBeLessThanOrEqual(group.x + group.w);
      expect(c.y + c.h, id).toBeLessThanOrEqual(group.y + group.h);
    }
    expect(box("ext.owner").x + box("ext.owner").w).toBeLessThanOrEqual(group.x);
    expect(flowNode("screen.people")!.getAttribute("aria-label")).toMatch(/evidence 0 pass, 0 fail, 0 unknown, 0 stale, \d+ not run/);
    // phenome counters: nothing promoted in fixture mode, so not-run (grey), never pass
    const badge = document.querySelector('[data-map-phenome="screen.people"]')!;
    const notRun = badge.querySelector('[data-counter="notRun"]')!;
    expect(notRun.getAttribute("data-tone")).toBe("subtle");
    expect(notRun.textContent).toMatch(/[1-9]/);
    expect(badge.querySelector('[data-counter="pass"]')!.textContent).toMatch(/0/);
    expect(router.state.location.search).toContain("focus=screen.people");
  });

  it("selecting a visible child keeps the scope; Backspace goes out to the parent", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    await waitFor(() => expect(nodeEl("component.AddContact")).not.toBeNull(), { timeout: 4000 });
    fireEvent.click(nodeEl("component.AddContact")!);
    await waitFor(() => expect(router.state.location.search).toContain("focus=component.AddContact"));
    expect(within(screen.getByRole("navigation", { name: "Map scope" })).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => expect(router.state.location.search).toContain("focus=section.ui"));
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Map scope" })).getAllByRole("listitem")).toHaveLength(3));
  });

  it("double-clicking a child makes it the new scope", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    await waitFor(() => expect(nodeEl("component.AddContactDialog")).not.toBeNull(), { timeout: 4000 });
    fireEvent.doubleClick(nodeEl("component.AddContactDialog")!);
    await waitFor(() => expect(router.state.location.search).toContain("focus=component.AddContactDialog"));
    await waitFor(() => expect(nodeEl("component.AddContactDialog")?.getAttribute("data-role")).toBe("scope"), { timeout: 4000 });
    await waitFor(() => expect(nodeEl("affordance.AddContactDialog.save")).not.toBeNull(), { timeout: 4000 });
  });
});

describe("Map scope rules", () => {
  it("focusing an object with no Map place (a requirement) keeps the view", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    await ready("component.AddContact");
    await act(() => router.navigate(`${MAP}?focus=S.webapp.scope`));
    await waitFor(() => expect(router.state.location.search).toContain("S.webapp.scope"));
    expect(crumbs()).toHaveLength(4);
    expect(nodeEl("screen.people")?.getAttribute("data-role")).toBe("scope");
  });

  it("focusing a criterion whose subject is on screen keeps the view; a subject elsewhere re-scopes", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    await ready("entity.ContactRecord");
    await act(() => router.navigate(`${MAP}?focus=C.webapp.contact.storage`));
    expect(crumbs()).toHaveLength(4);
    await act(() => router.navigate(`${MAP}?focus=component.GoalForm`));
    await waitFor(() => expect(crumbs().at(-1)?.textContent).toContain("GoalForm"));
  });

  it("clicking and hovering visible nodes never re-runs elk", async () => {
    const spy = vi.spyOn(elk, "layoutGraph");
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    await ready("component.AddContact");
    const runs = spy.mock.calls.length;
    fireEvent.mouseEnter(flowNode("component.ContactCollection")!);
    fireEvent.click(nodeEl("component.AddContact")!);
    await waitFor(() => expect(router.state.location.search).toContain("focus=component.AddContact"));
    fireEvent.mouseLeave(flowNode("component.ContactCollection")!);
    expect(spy.mock.calls.length).toBe(runs);
  });

  it("double-clicking a leaf opens its container, not an empty frame", async () => {
    const { router } = renderApp(`${MAP}?focus=screen.people`);
    await ready("entity.ContactRecord");
    fireEvent.doubleClick(nodeEl("entity.ContactRecord")!);
    await waitFor(() => expect(router.state.location.search).toContain("focus=entity.ContactRecord"));
    await waitFor(() => expect(crumbs().at(-1)?.textContent).toContain("Domain"));
    await waitFor(() => expect(nodeEl("entity.ContactRecord")?.getAttribute("data-role")).toBe("child"), { timeout: 4000 });
  });

  it("Backspace moves keyboard focus to the new scope frame", async () => {
    renderApp(`${MAP}?focus=screen.people`);
    await ready("component.AddContact");
    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => expect(document.activeElement).toBe(flowNode("section.ui")), { timeout: 4000 });
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
