import type { CSSProperties } from "react";
import type { MapLayer, ResolvedKindView } from "@artyfact/ontology";
import type { EntryType, IndexEntry } from "./index";
import type { ModelJson } from "./types";
import { useModelOptional } from "./useModel";

export const VIEWS = [
  "overview", "map", "journeys", "theory", "code", "work", "evaluations", "changelog", "compare", "phenome",
] as const;
export type ViewName = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewName, string> = {
  overview: "Overview",
  map: "Map",
  journeys: "Journeys",
  theory: "Theory",
  code: "Code",
  work: "Work",
  evaluations: "Evaluations",
  changelog: "Changelog",
  compare: "Compare",
  phenome: "Deployments",
};

/** One glyph per view (SideNav, never the only signal: always paired with the label). */
export const VIEW_GLYPHS: Record<ViewName, string> = {
  overview: "◎",
  map: "▦",
  journeys: "⇢",
  theory: "△",
  code: "{}",
  work: "⎇",
  evaluations: "✓",
  changelog: "↺",
  compare: "⇄",
  phenome: "◍",
};

export interface ViewGroup {
  /** Sentence-case group heading; `null` for the ungrouped Overview link. */
  label: string | null;
  views: ViewName[];
}

/** SideNav order: Overview, then the Genome, Proteome and Phenome groups. */
export const VIEW_GROUPS: ViewGroup[] = [
  { label: null, views: ["overview"] },
  { label: "Genome", views: ["map", "journeys", "theory", "code"] },
  { label: "Proteome", views: ["work", "evaluations", "changelog", "compare"] },
  { label: "Phenome", views: ["phenome"] },
];

/** `g` + key go-to shortcuts. `h` is the legacy History key and opens the Changelog. */
export const GO_KEYS: Record<string, ViewName> = {
  o: "overview", m: "map", j: "journeys", t: "theory", c: "code", w: "work", e: "evaluations",
  l: "changelog", h: "changelog", x: "compare", d: "phenome",
};

/** The view that best shows an object of this type (CommandPalette, "Open in" defaults). */
export function bestViewFor(type: EntryType | undefined): ViewName {
  switch (type) {
    case "system":
      return "overview";
    case "journey":
    case "step":
      return "journeys";
    case "purpose":
    case "claim":
    case "external":
    case "feature":
    case "commitment":
      return "theory";
    case "evolution":
      return "work";
    case "criterion":
    case "hook":
      return "evaluations";
    default:
      return "map";
  }
}

/** The kind a view needs the template to declare; views without one always show. */
export const VIEW_KINDS: Partial<Record<ViewName, string>> = { journeys: "journey", theory: "claim" };

export type { MapLayer, ResolvedKindView as KindView };

/**
 * How the UI shows every kind of one System, from its templates' view hints (`docs/design/ontology.md` §3). This module
 * is the one place the SPA resolves hints; a server-provided `views` map can replace `kindViews` without touching views.
 */
export interface KindViews {
  /** Hints for `kind`, defaults filled in (a kind no template declares gets defaults only). */
  of(kind: string): ResolvedKindView;
  /** True when one of the System's templates declares `kind`. */
  declares(kind: string): boolean;
  /** Map bands, top to bottom; empty when the templates declare none. */
  layers: MapLayer[];
}

/** Template refs a model pins: the System's, then each Thing's (v1 `templateRef`, v2 `template`), then node pins. */
export function templateRefs(model: ModelJson): string[] {
  const refs: unknown[] = [model.system.template];
  for (const t of model.things ?? []) refs.push((t as { templateRef?: unknown; template?: unknown }).templateRef ?? (t as { template?: unknown }).template);
  for (const n of model.nodes ?? []) refs.push((n as { template?: unknown }).template);
  return [...new Set(refs.filter((r): r is string => typeof r === "string" && r.length > 0))];
}

// The resolver (bundled templates + the ontology engine's template loader) is a lazy chunk: the System route loader
// and app start call `loadKindViews()`, so views render with it loaded.
type Resolver = typeof import("./kindResolver");
let resolver: Resolver | undefined;
let loading: Promise<void> | undefined;

/** Loads the hint resolver once; `kindViews` answers bare defaults until it has. */
export function loadKindViews(): Promise<void> {
  loading ??= import("./kindResolver").then((m) => {
    resolver = m;
  });
  return loading;
}

/** Before the resolver loads: the kind name and neutral defaults, nothing declared, no layers. */
const BARE: KindViews = {
  of: (kind) => ({ kind, label: kind, plural: kind, glyph: "•", colour: "neutral", fields: [], summary: "description" }),
  declares: () => true,
  layers: [],
};

const byRefs = new Map<string, KindViews>();
const byModel = new WeakMap<ModelJson, KindViews>();

/** The kind views of the model's templates (the base template's for no model), memoised per model and per ref list. */
export function kindViews(model: ModelJson | undefined): KindViews {
  if (!resolver) return BARE;
  const hit = model && byModel.get(model);
  if (hit) return hit;
  const refs = model ? templateRefs(model) : [];
  const key = refs.join("\n");
  const views = byRefs.get(key) ?? byRefs.set(key, resolver.kindViewsFor(refs)).get(key)!;
  if (model) byModel.set(model, views);
  return views;
}

/** The current System's kind views (the base template's outside a System). */
export function useKindViews(): KindViews {
  return kindViews(useModelOptional()?.index.model);
}

/** Resolved view hints for one kind of the current System. */
export function useKindView(kind: string): ResolvedKindView {
  return useKindViews().of(kind);
}

/** The value of `field` on a model object: its own property, else from a v2 node's `fields` map. */
export function fieldValue(item: unknown, field: string): unknown {
  if (!item || typeof item !== "object") return undefined;
  const o = item as Record<string, unknown>;
  if (field in o) return o[field];
  const f = o.fields;
  return f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, unknown>)[field] : undefined;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/** The name to show for an entry: its kind's `title` field, else the indexed name, else the id. */
export const titleOf = (entry: Pick<IndexEntry, "id" | "name" | "item">, view: ResolvedKindView): string =>
  (view.title && text(fieldValue(entry.item, view.title))) || entry.name || entry.id;

/** The line shown under the name: the kind's `summary` field, when it holds text. */
export const summaryOf = (entry: Pick<IndexEntry, "item">, view: ResolvedKindView): string | undefined =>
  text(fieldValue(entry.item, view.summary));

/** Inline style that sets `--kind` to the kind's themed colour token (`theme/tokens.css`). */
export const kindColour = (view: ResolvedKindView) => ({ "--kind": `var(--kind-${view.colour})` }) as CSSProperties;
