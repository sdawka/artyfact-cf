import type { CSSProperties } from "react";
import type { MapLayer, ResolvedKindView } from "@artyfact/ontology";
import type { EntryType, IndexEntry } from "./index";
import type { ModelJson } from "./types";
import { useModelOptional } from "./useModel";

export const VIEWS = [
  "overview", "map", "journeys", "theory", "code", "work", "review", "evaluations", "changelog", "compare", "phenome",
] as const;
export type ViewName = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewName, string> = {
  overview: "Overview",
  map: "Map",
  journeys: "Journeys",
  theory: "Theory",
  code: "Code",
  work: "Work",
  review: "Review",
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
  review: "◧",
  evaluations: "✓",
  changelog: "↺",
  compare: "⇄",
  phenome: "◍",
};

/** The question each layer answers; the rail's group sublines and the Overview meters share these words. */
export const LAYER_QUESTIONS = {
  genome: "What should it be",
  proteome: "What is being made",
  phenome: "What does it do",
} as const;

export interface ViewGroup {
  /** The layer name heading the group (the group's accessible label); `null` for the ungrouped Overview link. */
  label: string | null;
  /** The question this layer answers, shown in sentence case under the label (the group's description). */
  question?: string;
  views: ViewName[];
}

/**
 * SideNav order: Map, Overview, then the Genome, Proteome and Phenome groups. Compare is not on the rail; it opens from a
 * Changelog row ("Compare with parent") and `g x`.
 */
export const VIEW_GROUPS: ViewGroup[] = [
  { label: null, views: ["map", "overview"] },
  { label: "Genome", question: LAYER_QUESTIONS.genome, views: ["journeys", "theory", "code"] },
  { label: "Proteome", question: LAYER_QUESTIONS.proteome, views: ["work", "review", "evaluations", "changelog"] },
  { label: "Phenome", question: LAYER_QUESTIONS.phenome, views: ["phenome"] },
];

/** `g` + key go-to shortcuts. `h` is the legacy History key and opens the Changelog. */
export const GO_KEYS: Record<string, ViewName> = {
  o: "overview", m: "map", j: "journeys", t: "theory", c: "code", w: "work", r: "review", e: "evaluations",
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
 * How the UI shows every kind of one System, from its composed template's view hints (`docs/design/ontology.md` §3),
 * which the server resolves and ships as the model's `views` map. This module is the one place the SPA reads hints.
 */
export interface KindViews {
  /** Hints for `kind`, defaults filled in (a kind the template does not declare gets defaults only). */
  of(kind: string): ResolvedKindView;
  /** True when the System's composed template declares `kind` (always, for a model without `views`). */
  declares(kind: string): boolean;
  /** Map bands in template layer order, drawn left to right; empty when the template declares none. */
  layers: MapLayer[];
}

const sentence = (kind: string) => {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : kind;
};

/** The engine's defaults for a kind with no hints (`resolveKindView` on an undeclared kind). */
const bare = (kind: string): ResolvedKindView => {
  const label = sentence(kind);
  return { kind, label, plural: `${label}s`, glyph: "•", colour: "neutral", fields: [], summary: "description" };
};

/** A model without a `views` map (an older bundle): defaults for every kind, all declared, no layers. */
const BARE: KindViews = { of: bare, declares: () => true, layers: [] };

const byModel = new WeakMap<ModelJson, KindViews>();

/** The kind views the model carries, memoised per model; bare defaults for no model or a missing map. */
export function kindViews(model: ModelJson | undefined): KindViews {
  const map = model?.views;
  if (!model || !map) return BARE;
  const hit = byModel.get(model);
  if (hit) return hit;
  const views: KindViews = { of: (kind) => map.kinds[kind] ?? bare(kind), declares: (kind) => kind in map.kinds, layers: map.layers };
  byModel.set(model, views);
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
