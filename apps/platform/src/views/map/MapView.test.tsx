import "./testing/flowEnv";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

const MAP = "/s/system.keep-in-touch/r/head/map";
const nodeEl = (id: string) => document.querySelector(`[data-map-node="${id}"]`);

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
    // children are nested inside the scope group (React Flow parent), not linked by edges
    const child = nodeEl("component.SearchInput")!.closest(".react-flow__node") as HTMLElement;
    expect(child.dataset.id).toBe("component.SearchInput");
    expect(nodeEl("screen.people")?.getAttribute("data-role")).toBe("scope");
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
    expect(active().textContent).toContain("PageHeading");
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
