import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as elk from "./elk";
import { clearLayoutCache, useElkLayout } from "./useElkLayout";

const req: elk.LayoutRequest = {
  nodes: [
    { id: "a", width: 100, height: 40 },
    { id: "b", width: 100, height: 40 },
  ],
  edges: [{ id: "e", source: "a", target: "b" }],
};

describe("useElkLayout", () => {
  // The first layout pays a cold dynamic import of the large elk bundle; do that here, with a real
  // timeout, so the waitFor calls below only wait for a layout, not for module loading under load.
  beforeAll(async () => {
    await elk.layoutGraph(req, { worker: false });
  }, 60_000);
  afterEach(() => void vi.restoreAllMocks());

  it("lays out, then serves the same key from the memo without re-running elk", async () => {
    clearLayoutCache();
    const spy = vi.spyOn(elk, "layoutGraph");
    const first = renderHook(() => useElkLayout(req, "k1"));
    expect(first.result.current.pending).toBe(true);
    await waitFor(() => expect(first.result.current.layout).not.toBeNull());
    const { a, b } = first.result.current.layout!.nodes;
    expect(a!.x).toBeLessThan(b!.x);
    expect(first.result.current.pending).toBe(false);

    const second = renderHook(() => useElkLayout(req, "k1"));
    expect(second.result.current.layout).toBe(first.result.current.layout);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("defaults the key to the request's shape, so an equal request hits the memo", async () => {
    clearLayoutCache();
    const first = renderHook(() => useElkLayout(req));
    await waitFor(() => expect(first.result.current.layout).not.toBeNull());
    const again = renderHook(() => useElkLayout(structuredClone(req)));
    expect(again.result.current.layout).toBe(first.result.current.layout);
    const bigger = renderHook(() => useElkLayout({ ...req, nodes: [...req.nodes, { id: "c", width: 10, height: 10 }] }));
    expect(bigger.result.current.pending).toBe(true);
    // Let it finish so no elk work outlives the test (and the jsdom environment).
    await waitFor(() => expect(bigger.result.current.layout).not.toBeNull());
  });

  it("cancels pending layout work on unmount", async () => {
    clearLayoutCache();
    const seen: AbortSignal[] = [];
    const real = elk.layoutGraph;
    vi.spyOn(elk, "layoutGraph").mockImplementation((r, o) => {
      seen.push(o!.signal!);
      return real(r, o);
    });
    const { unmount } = renderHook(() => useElkLayout(req, "cancel"));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.aborted).toBe(false);
    unmount();
    expect(seen[0]!.aborted).toBe(true);
  });

  it("returns nothing for a null request", () => {
    const { result } = renderHook(() => useElkLayout(null, "none"));
    expect(result.current).toEqual({ layout: null, pending: false, error: null });
  });
});
