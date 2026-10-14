import { useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { useModel } from "./useModel";
import { useKeepParams } from "./useSelection";

/** Search param that lifts the Thing filter ("Show all"). Kept per view: nav links do not carry it. */
export const SHOW_ALL_PARAM = "all";

/**
 * Thing scope for a System view that is open under `…/things/:thingId/…`. Inside a Thing path the view shows that
 * Thing's items by default; `?all=1` ("Show all") lifts the filter. Outside a Thing path (or for an unknown Thing)
 * nothing is filtered: `active` is false, `thingId` is undefined and every helper passes items through.
 */
export interface ThingFilter {
  /** The route's Thing, when the path has one that exists in this revision. */
  thing: { id: string; name: string } | undefined;
  /** True while the filter applies: a Thing in the path and no `?all=1`. */
  active: boolean;
  /** The Thing id to pass to queries and filters; undefined when not active. */
  thingId: string | undefined;
  /** Whether the user lifted the filter (`?all=1`). */
  showAll: boolean;
  /** Lift or restore the filter, replacing the history entry. */
  setShowAll(on: boolean): void;
  /** Whether a node is the Thing or inside it (containment path). True for everything when not active. */
  includesNode(id: string): boolean;
  /** Whether any of the nodes is the Thing or inside it. True for everything when not active. */
  includesAny(ids: readonly string[]): boolean;
  /** Keep the items whose nodes (`nodesOf`) touch the Thing. Items pass through when not active. */
  filter<T>(items: readonly T[], nodesOf: (item: T) => readonly string[]): T[];
}

export function useThingFilter(): ThingFilter {
  const { thingId } = useParams();
  const [params, setParams] = useSearchParams();
  const m = useModel();
  const thing = thingId ? m.bundle.model.things.find((t) => t.id === thingId) : undefined;
  const showAll = params.get(SHOW_ALL_PARAM) === "1";
  const active = !!thing && !showAll;
  const id = thing?.id;
  const setShowAll = useCallback(
    (on: boolean) => setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set(SHOW_ALL_PARAM, "1");
      else next.delete(SHOW_ALL_PARAM);
      return next;
    }, { replace: true }),
    [setParams],
  );
  return useMemo<ThingFilter>(() => {
    const includesNode = (node: string) => !active || node === id || m.path(node).some((e) => e.id === id);
    const includesAny = (nodes: readonly string[]) => !active || nodes.some(includesNode);
    return {
      thing: thing && { id: thing.id, name: thing.name || thing.id },
      active,
      thingId: active ? id : undefined,
      showAll,
      setShowAll,
      includesNode,
      includesAny,
      filter: (items, nodesOf) => (active ? items.filter((item) => includesAny(nodesOf(item))) : [...items]),
    };
  }, [active, id, thing, showAll, setShowAll, m]);
}

/**
 * `useKeepParams` for links that stay on the current view (a Work row, a Review row): they also keep a lifted Thing
 * filter (`?all=1`), which nav links to other views drop. `extra` can still set or clear it.
 */
export function useStayHref() {
  const keep = useKeepParams();
  const [params] = useSearchParams();
  const all = params.get(SHOW_ALL_PARAM);
  return useCallback(
    (target: string, extra: Record<string, string | null> = {}) => keep(target, { [SHOW_ALL_PARAM]: all, ...extra }),
    [keep, all],
  );
}
