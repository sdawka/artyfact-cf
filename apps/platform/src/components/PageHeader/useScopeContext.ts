import { useParams, useSearchParams } from "react-router";
import { VIEW_LABELS } from "@/model/kinds";
import { useModelOptional } from "@/model/useModel";
import { thingPath, useSystemRoute, viewPath } from "@/model/useSelection";

/** One step of the scope path: a link, or the current item (no `to`). */
export interface ScopeCrumb { label: string; to?: string }

/**
 * The scope path for the PageHeader context slot, read from the route: System / Thing / View inside a Thing workspace,
 * Environment / System / … / node on a Map scope. Empty elsewhere (a System-wide view needs no path; the rail says where you are).
 */
export function useScopeContext(): ScopeCrumb[] {
  const { thingId } = useParams();
  const [params] = useSearchParams();
  const { systemId, rev, view } = useSystemRoute();
  const model = useModelOptional();
  if (!systemId || !model) return [];
  const system = model.bundle.model.system.name || systemId;
  const scope = params.get("scope");
  if (view === "map" && scope) {
    const map = (id: string) => `${viewPath(systemId, rev, "map")}?scope=${encodeURIComponent(id)}`;
    if (scope === "environment") return [{ label: "Environment" }];
    const path = model.path(scope);
    if (!path.length) return [];
    const crumbs: ScopeCrumb[] = [{ label: "Environment", to: map("environment") }, ...path.map((e) => ({ label: e.name || e.id, to: map(e.id) }))];
    delete crumbs[crumbs.length - 1]!.to;
    return crumbs;
  }
  const thing = thingId ? model.bundle.model.things.find((t) => t.id === thingId) : undefined;
  if (!thing) return [];
  const crumbs: ScopeCrumb[] = [
    { label: system, to: viewPath(systemId, rev, "overview") },
    { label: thing.name || thing.id, to: thingPath(systemId, rev, thing.id) },
  ];
  if (view && view !== "overview") crumbs.push({ label: VIEW_LABELS[view] });
  else delete crumbs[1]!.to;
  return crumbs;
}
