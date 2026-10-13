// Lazy chunk behind `loadKindViews()` (kinds.ts): the bundled templates and the engine's template loader.
import { ARTYFACT_GENOME, resolveKindView, type ResolvedKindView } from "@artyfact/ontology";
import { loadMetaTemplate, type MetaTemplate } from "@artyfact/templates";
import type { KindViews } from "./kinds";

const load = (ref: string): MetaTemplate | undefined => {
  try {
    return loadMetaTemplate(ref);
  } catch {
    return undefined; // a v1-only or unknown ref: its kinds fall back to the base template's hints
  }
};

/**
 * Merges the templates' kinds (a later template's declaration wins, so a Thing template's hints override the System's)
 * and takes `view.layers` from the first template that declares any (the System's when it does). No resolvable ref
 * means the engine's base template.
 */
export function kindViewsFor(refs: readonly string[]): KindViews {
  const loaded = refs.map(load).filter((t): t is MetaTemplate => !!t);
  const chain = loaded.length ? loaded : [loadMetaTemplate(ARTYFACT_GENOME)];
  const kinds: MetaTemplate["kinds"] = {};
  for (const t of chain) Object.assign(kinds, t.kinds);
  const layers = chain.find((t) => t.view?.layers?.length)?.view?.layers ?? [];
  const merged = { kinds, view: { layers } };
  const cache = new Map<string, ResolvedKindView>();
  return {
    of: (kind) => cache.get(kind) ?? cache.set(kind, resolveKindView(merged, kind)).get(kind)!,
    declares: (kind) => kind in kinds,
    layers,
  };
}
