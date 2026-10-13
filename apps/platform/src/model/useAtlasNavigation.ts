import { useCallback, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { Criterion, JourneyStep } from "./types";
import { useModel } from "./useModel";
import { thingPath, useSystemRoute, viewPath } from "./useSelection";

const ENVIRONMENT = "environment";

/** Map depth is URL state; selection and Details never change its scope. */
export function useAtlasNavigation(): {
  scope: string;
  select(id: string | null): void;
  /** Explicit search/Locate navigates scope and selection atomically, without Details. */
  locate(id: string): void;
  enter(id: string): void;
  up(): void;
  showDetails(id?: string): void;
  closeDetails(): void;
} {
  const { index } = useModel();
  const { systemId, rev, view } = useSystemRoute();
  const { thingId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const root = index.model.system.id;
  const validScope = useCallback((id: string | null): id is string =>
    id === ENVIRONMENT || (!!id && !!index.byId(id) && (id === root || (!!index.parent(id) && index.children(id).length > 0))), [index, root]);
  const legacyScope = useCallback((id: string | null): string | null => {
    const seen = new Set<string>();
    let entry = id ? index.byId(id) : undefined;
    while (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      if (entry.type === "criterion") { entry = index.byId((entry.item as Criterion).subjectId); continue; }
      if (entry.type === "step") { const screen = (entry.item as JourneyStep).screen; entry = screen ? index.byId(screen) : undefined; continue; }
      if (entry.type === "external") return ENVIRONMENT;
      if (entry.id === root || index.parent(entry.id)) return index.children(entry.id).length ? entry.id : index.parent(entry.id)?.id ?? root;
      return null;
    }
    return null;
  }, [index, root, validScope]);
  const explicit = params.get("scope");
  const fallback = validScope(thingId ?? null) ? thingId! : ENVIRONMENT;
  const scope = validScope(explicit) ? explicit : (explicit ? legacyScope(explicit) : legacyScope(params.get("focus"))) ?? fallback;

  // Normalize legacy links once so subsequent selection cannot silently alter depth.
  useEffect(() => {
    if (view !== "map" || explicit === scope) return;
    setParams((prev) => { const next = new URLSearchParams(prev); next.set("scope", scope); return next; }, { replace: true });
  }, [view, explicit, scope, setParams]);

  const replace = useCallback((change: (next: URLSearchParams) => void) => {
    setParams((prev) => { const next = new URLSearchParams(prev); next.set("scope", scope); change(next); return next; }, { replace: true });
  }, [scope, setParams]);
  const select = useCallback((id: string | null) => replace((next) => {
    if (id) next.set("focus", id); else next.delete("focus");
    next.delete("inspect");
  }), [replace]);
  const move = useCallback((target: string) => {
    if (target === scope) return;
    const next = new URLSearchParams(params);
    next.set("scope", target); next.delete("focus"); next.delete("inspect");
    // A Thing boundary cannot contain environment or another Thing's scope.
    const insideThing = thingId && target !== ENVIRONMENT && index.path(target).some((e) => e.id === thingId);
    const path = insideThing ? undefined : viewPath(systemId, rev, "map");
    if (path) void navigate({ pathname: path, search: `?${next}` });
    else setParams(next);
  }, [scope, params, thingId, index, systemId, rev, navigate, setParams]);
  const locate = useCallback((id: string) => {
    const entry = index.byId(id);
    if (!entry) return;
    const target = id === root || entry.type === "external" ? ENVIRONMENT : index.parent(id)?.id;
    if (!target || !validScope(target)) return;
    const next = new URLSearchParams(params);
    next.set("scope", target); next.set("focus", id); next.delete("inspect");
    const insideThing = thingId && target !== ENVIRONMENT && index.path(target).some((part) => part.id === thingId);
    const pathname = insideThing ? `${thingPath(systemId, rev, thingId!)}/map` : viewPath(systemId, rev, "map");
    // The transient route state requests a camera Locate; it is separate from durable URL depth/selection.
    void navigate({ pathname, search: `?${next}` }, { replace: view === "map" && target === scope, state: { atlasLocate: id } });
  }, [index, root, validScope, params, thingId, systemId, rev, navigate, scope, view]);
  const enter = useCallback((id: string) => {
    if (id === ENVIRONMENT || (validScope(id) && index.children(id).length)) move(id);
  }, [validScope, index, move]);
  const up = useCallback(() => {
    if (scope === ENVIRONMENT) return;
    move(scope === root ? ENVIRONMENT : index.parent(scope)?.id ?? ENVIRONMENT);
  }, [scope, root, index, move]);
  const showDetails = useCallback((id?: string) => replace((next) => {
    const target = id ?? next.get("focus");
    if (!target) return;
    next.set("focus", target); next.set("inspect", "1");
  }), [replace]);
  const closeDetails = useCallback(() => replace((next) => next.delete("inspect")), [replace]);
  return { scope, select, locate, enter, up, showDetails, closeDetails };
}
