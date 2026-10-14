import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "@xyflow/react";
import type { MapGraph } from "./useMapGraph";
import { AtlasCamera, saveAtlasCamera } from "./AtlasCamera";
const state = vi.hoisted(() => ({ enabled: true, reduced: false, viewport: { x: 0, y: 0, zoom: 1 }, setViewport: vi.fn() }));
const index = { descendants: () => [] };
const rf = { viewportInitialized: true, getViewport: () => state.viewport, setViewport: state.setViewport };
vi.mock("@xyflow/react", () => ({ Controls: () => null, useReactFlow: () => rf }));
vi.mock("@artyfact/effects", () => ({ useSystemReducedMotion: () => state.reduced }));
vi.mock("@/effects/effectsPreference", () => ({ useEffectsPreference: () => ({ enabled: state.enabled }) }));
vi.mock("@/model/useModel", () => ({ useModel: () => ({ index }) }));
const graph = { scope: "a", nodes: [], edges: [], ids: new Set() } as unknown as MapGraph;
const layout = { boxes: { a: { x: 0, y: 0, width: 600, height: 400 }, b: { x: 100, y: 80, width: 200, height: 100 } }, width: 600, height: 400 };
let canvas: HTMLDivElement, key = 0;
const props = () => ({ cameraKey: `camera-test-${++key}`, graph, layout, canvas, focusId: null, locate: null, travel: null, onLocate: vi.fn(), onTravel: vi.fn(), onCancelTravel: vi.fn() });
beforeEach(() => {
  canvas = document.createElement("div"); canvas.className = "react-flow"; Object.defineProperties(canvas, { clientWidth: { value: 900 }, clientHeight: { value: 600 } });
  state.enabled = true; state.reduced = false; state.viewport = { x: 0, y: 0, zoom: 1 };
  state.setViewport.mockReset().mockImplementation((v: Viewport) => { state.viewport = v; return Promise.resolve(true); });
});
afterEach(cleanup);
describe("Atlas camera asynchronous ownership", () => {
  it("rejects nonfinite saved cameras rather than poisoning a later scope restore", () => {
    const p = props();
    saveAtlasCamera(p.cameraKey, { x: Number.NaN, y: 40, zoom: 1 });
    render(<AtlasCamera {...p} />);
    expect(state.setViewport).toHaveBeenCalledWith(expect.objectContaining({ zoom: 1.1 }));
    expect(state.setViewport.mock.calls.every(([viewport]) => Object.values(viewport).every(value => typeof value === "number" && Number.isFinite(value)))).toBe(true);
  });
  it("cancels an unfinished Enter on user wheel without navigating when the stale promise resolves", async () => {
    const p = props(), view = render(<AtlasCamera {...p} />);
    let finish!: () => void;
    state.setViewport.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    view.rerender(<AtlasCamera {...p} travel={{ id: "b", target: "b", kind: "enter", sequence: 1 }} />);
    fireEvent.wheel(canvas);
    await act(async () => finish());
    expect(p.onCancelTravel).toHaveBeenCalledOnce(); expect(p.onTravel).not.toHaveBeenCalled();
  });
  it("cancels cross-scope Locate before committing its destination while retaining the current URL scope", async () => {
    const p = props(), view = render(<AtlasCamera {...p} />);
    let finish!: () => void;
    state.setViewport.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    view.rerender(<AtlasCamera {...p} travel={{ historyKey: "test-entry", source: "a", id: "b", target: "other", focus: "leaf", kind: "locate", sequence: 1 }} />);
    fireEvent.pointerDown(canvas);
    await act(async () => finish());
    expect(p.onCancelTravel).toHaveBeenCalledOnce(); expect(p.onTravel).not.toHaveBeenCalled();
  });
  it("keeps Locate running while a navigation overlay is dismissed", async () => {
    const p = props(), overlay = document.createElement("button");
    canvas.className = ""; canvas.append(overlay);
    const flow = document.createElement("div"); flow.className = "react-flow"; canvas.append(flow);
    const view = render(<AtlasCamera {...p} />);
    let finish!: () => void;
    state.setViewport.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    view.rerender(<AtlasCamera {...p} locate={{ id: "b", sequence: 1 }} />);
    fireEvent.pointerDown(overlay);
    expect(p.onCancelTravel).not.toHaveBeenCalled();
    await act(async () => finish());
  });
  it("allows only the latest rapid Enter then Up request to navigate", async () => {
    const p = props(), view = render(<AtlasCamera {...p} />);
    let first!: () => void, second!: () => void;
    state.setViewport.mockImplementationOnce(() => new Promise<void>(resolve => { first = resolve; })).mockImplementationOnce(() => new Promise<void>(resolve => { second = resolve; }));
    view.rerender(<AtlasCamera {...p} travel={{ id: "b", target: "b", kind: "enter", sequence: 1 }} />);
    view.rerender(<AtlasCamera {...p} travel={{ id: "a", target: "environment", kind: "up", sequence: 2 }} />);
    await act(async () => first()); expect(p.onTravel).not.toHaveBeenCalled();
    await act(async () => second()); expect(p.onTravel).toHaveBeenCalledWith(expect.objectContaining({ target: "environment", sequence: 2 }));
  });
  it("does not save an old Locate camera into a scope replaced during its animation", async () => {
    const p = props(), view = render(<AtlasCamera {...p} />);
    let finish!: () => void;
    state.setViewport.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    view.rerender(<AtlasCamera {...p} locate={{ id: "b", sequence: 1 }} />);
    const next = { ...p, cameraKey: `${p.cameraKey}-other`, graph: { ...graph, scope: "b" } };
    view.rerender(<AtlasCamera {...next} />);
    await act(async () => finish());
    state.setViewport.mockClear();
    view.rerender(<AtlasCamera {...p} />);
    expect(state.setViewport).toHaveBeenCalledWith(expect.objectContaining({ zoom: 1.1 }));
  });
  it.each(["off", "reduced"])("uses zero-duration camera steps for %s", async mode => {
    state.enabled = mode !== "off"; state.reduced = mode === "reduced";
    const p = props(), view = render(<AtlasCamera {...p} />);
    view.rerender(<AtlasCamera {...p} travel={{ id: "b", target: "b", kind: "enter", sequence: 1 }} />);
    await act(async () => {});
    expect(state.setViewport).toHaveBeenLastCalledWith(expect.anything(), { duration: 0 });
    expect(p.onTravel).toHaveBeenCalledOnce();
  });
});
