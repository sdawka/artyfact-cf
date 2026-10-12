import { useEffect, useMemo, useState } from "react";
import { layoutGraph, requestKey, type LayoutRequest, type LayoutResult } from "./elk";

export interface ElkLayoutState {
  /** Layout for the current `key`; null while pending or for a null request. */
  layout: LayoutResult | null;
  pending: boolean;
  error: Error | null;
}

const MAX = 64;
const cache = new Map<string, LayoutResult>();
const remember = (key: string, value: LayoutResult) => {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
};

const recall = (key: string) => {
  const hit = cache.get(key);
  if (hit) remember(key, hit); // refresh recency (LRU)
  return hit;
};

/** Drops every memoised layout (tests). */
export const clearLayoutCache = () => cache.clear();

/**
 * Runs `layoutGraph(request)` and memoises the result per key (module-wide LRU of 64), so a key
 * seen before renders synchronously with no elk run. The key defaults to `requestKey(request)`,
 * derived from the request's shape; pass `keyOverride` only to add context (it should still change with
 * the shape, e.g. `${requestKey(req)}|${extra}`).
 */
export function useElkLayout(request: LayoutRequest | null, keyOverride?: string): ElkLayoutState {
  const key = useMemo(() => keyOverride ?? (request ? requestKey(request) : ""), [keyOverride, request]);
  const [state, setState] = useState<{ key: string; layout: LayoutResult | null; error: Error | null }>({
    key: "",
    layout: null,
    error: null,
  });
  const cached = request ? recall(key) : undefined;

  useEffect(() => {
    if (!request || cache.has(key)) return;
    const ctl = new AbortController();
    layoutGraph(request, { signal: ctl.signal }).then(
      (layout) => {
        remember(key, layout);
        if (!ctl.signal.aborted) setState({ key, layout, error: null });
      },
      (err: unknown) => {
        if (!ctl.signal.aborted) setState({ key, layout: null, error: err instanceof Error ? err : new Error(String(err)) });
      },
    );
    // Unmount or key change cancels pending work (timer cleared, no elk run started) instead of just ignoring it.
    return () => ctl.abort();
    // `request` is identified by `key`.
  }, [key, request === null]);

  if (!request) return { layout: null, pending: false, error: null };
  if (cached) return { layout: cached, pending: false, error: null };
  if (state.key === key) return { layout: state.layout, pending: false, error: state.error };
  return { layout: null, pending: true, error: null };
}
