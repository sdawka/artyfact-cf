import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("returns nothing for a null request", () => {
    const { result } = renderHook(() => useElkLayout(null, "none"));
    expect(result.current).toEqual({ layout: null, pending: false, error: null });
  });
});
