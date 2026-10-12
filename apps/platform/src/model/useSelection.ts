import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { VIEWS, type ViewName } from "./kinds";

export const DEFAULT_REV = "head";

/** Search params every nav link carries across views. View-specific params (journey, step, ...) are dropped. */
export const GLOBAL_PARAMS = ["focus", "layer", "candidates"] as const;

export const LAYERS = ["genome", "proteome", "phenome"] as const;
export type Layer = (typeof LAYERS)[number];

const isView = (s: string | undefined): s is ViewName => !!s && (VIEWS as readonly string[]).includes(s);

/**
 * `systemId`, `rev` and the current view from `/s/:systemId/r/:rev/:view`. Outside `/s/` (Home, `/style`)
 * `systemId` is `""`: there is no current System, and System-scoped queries stay disabled.
 */
export function useSystemRoute(): { systemId: string; rev: string; view: ViewName | undefined } {
  const { systemId, rev } = useParams();
  const { pathname } = useLocation();
  const last = pathname.split("/").filter(Boolean).at(-1);
  return { systemId: systemId ?? "", rev: rev ?? DEFAULT_REV, view: isView(last) ? last : undefined };
}

export const viewPath = (systemId: string, rev: string, view: ViewName) =>
  `/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/${view}`;

/**
 * Returns `href(target, extra?)`: a link to a view (or any path) that keeps `focus`, `layer`
 * and `candidates`. `extra` adds params; a `null` value removes one.
 */
export function useKeepParams() {
  const [params] = useSearchParams();
  const { systemId, rev } = useSystemRoute();
  return useCallback(
    (target: ViewName | string, extra: Record<string, string | null> = {}) => {
      const next = new URLSearchParams();
      for (const k of GLOBAL_PARAMS) {
        const v = params.get(k);
        if (v !== null) next.set(k, v);
      }
      for (const [k, v] of Object.entries(extra)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const path = isView(target) ? viewPath(systemId, rev, target) : target;
      const qs = next.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [params, systemId, rev],
  );
}

export interface Selection {
  focusId: string | null;
  /** Focus `id` (null clears). With `view`, navigates there keeping global params. */
  setFocus(id: string | null, opts?: { view?: ViewName }): void;
  layer: Layer;
  setLayer(layer: Layer): void;
  candidates: string[];
  setCandidates(ids: string[]): void;
  /** Clears the focus (closes the Inspector). */
  clear(): void;
}

export function useSelection(): Selection {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const href = useKeepParams();
  const { view: current } = useSystemRoute();

  const focusId = params.get("focus");
  const rawLayer = params.get("layer");
  const layer: Layer = (LAYERS as readonly string[]).includes(rawLayer ?? "") ? (rawLayer as Layer) : "genome";
  const candidatesParam = params.get("candidates");
  const candidates = useMemo(() => (candidatesParam ? candidatesParam.split(",").filter(Boolean) : []), [candidatesParam]);

  const update = useCallback(
    (key: string, value: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      }),
    [setParams],
  );

  const setFocus = useCallback(
    (id: string | null, opts: { view?: ViewName } = {}) => {
      if (opts.view && opts.view !== current) void navigate(href(opts.view, { focus: id }));
      else update("focus", id);
    },
    [current, href, navigate, update],
  );

  return {
    focusId,
    setFocus,
    layer,
    setLayer: useCallback((l: Layer) => update("layer", l), [update]),
    candidates,
    setCandidates: useCallback((ids: string[]) => update("candidates", ids.join(",")), [update]),
    clear: useCallback(() => update("focus", null), [update]),
  };
}
