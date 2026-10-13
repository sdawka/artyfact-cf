import { z } from "zod";
import type { Template } from "../meta/template.ts";

/**
 * Template view hints: how the platform UI shows each kind, so no UI code branches on a kind name. They sit beside the
 * engine's own kind declaration (`kinds.<k>.view`, `view` at the template root) and never change evaluation.
 */

const name = z.string().min(1);

/** Categorical colours; the UI maps each to a themed token (`--kind-<token>`), light and dark. */
export const COLOUR_TOKENS = ["neutral", "slate", "blue", "indigo", "violet", "pink", "red", "orange", "amber", "lime", "green", "teal"] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];

export const KindViewSchema = z.strictObject({
  /** Singular display name. Default: the kind name in sentence case (`durableObject` → "Durable object"). */
  label: z.string().min(1).optional(),
  /** Default: `label` + "s". */
  plural: z.string().min(1).optional(),
  /** One to two characters shown before a name; never the only signal. Default "•". */
  glyph: z.string().min(1).max(2).optional(),
  /** Default `neutral`. */
  colour: z.enum(COLOUR_TOKENS).optional(),
  /** The Map layer (an id from the template's `view.layers`) this kind is drawn in; see `TemplateViewSchema`. */
  layer: name.optional(),
  /** Inspector field order; fields left out follow in declaration order. */
  fields: z.array(name).optional(),
  /** The field shown as the node's name. Default `title`, then `name`, then the id. */
  title: name.optional(),
  /** The field shown under the name in chips and cards. Default `description`. */
  summary: name.optional(),
});

export const MapLayerSchema = z.strictObject({ id: name, label: z.string().min(1), description: z.string().optional() });

/**
 * Template-wide view hints. `layers` are the Map's bands, left to right. When the template (chain) declares layers, a
 * kind is drawn on the Map only if its `view.layer` names one; with no layers, the Map bands nodes by containment depth
 * and draws every kind.
 */
export const TemplateViewSchema = z.strictObject({ layers: z.array(MapLayerSchema).optional() });

export type KindView = z.infer<typeof KindViewSchema>;
export type MapLayer = z.infer<typeof MapLayerSchema>;
export type TemplateView = z.infer<typeof TemplateViewSchema>;

/** Every hint filled in; `layer` stays undefined when the kind is in no layer. */
export interface ResolvedKindView {
  kind: string;
  label: string;
  plural: string;
  glyph: string;
  colour: ColourToken;
  layer?: string;
  fields: string[];
  title?: string;
  summary: string;
}

const sentence = (kind: string) => {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : kind;
};

type ViewSource = Pick<Template, "kinds"> & { view?: TemplateView };

/** The view of `kind` with defaults applied; a kind the template does not declare gets defaults only. */
export function resolveKindView(t: ViewSource, kind: string): ResolvedKindView {
  const k = t.kinds[kind];
  const v: KindView = k?.view ?? {};
  const label = v.label ?? sentence(kind);
  const declared = (k?.fields ?? []).map((f) => f.name);
  const order = v.fields ?? [];
  return {
    kind,
    label,
    plural: v.plural ?? `${label}s`,
    glyph: v.glyph ?? "•",
    colour: v.colour ?? "neutral",
    ...(v.layer !== undefined && { layer: v.layer }),
    fields: [...order, ...declared.filter((f) => !order.includes(f))],
    ...(v.title !== undefined && { title: v.title }),
    summary: v.summary ?? "description",
  };
}

export interface ViewProblem { kind?: string; message: string }

/** Fields a node may carry whatever its kind declares (the engine's `validateOps` allows the same). */
const ALWAYS = ["title", "description"];

/**
 * Consistency of the view hints with the template: duplicate layer ids, a kind in an undeclared layer, and field
 * names (`fields`, `title`, `summary`) the kind does not declare.
 */
export function checkViewHints(t: ViewSource): ViewProblem[] {
  const out: ViewProblem[] = [];
  const layers = t.view?.layers ?? [];
  const ids = new Set<string>();
  for (const l of layers) {
    if (ids.has(l.id)) out.push({ message: `layer ${l.id} is declared twice` });
    ids.add(l.id);
  }
  for (const [kind, k] of Object.entries(t.kinds)) {
    const v = k.view;
    if (!v) continue;
    if (v.layer !== undefined && !ids.has(v.layer)) out.push({ kind, message: `layer ${v.layer} is not declared in view.layers` });
    const declared = new Set([...ALWAYS, ...k.fields.map((f) => f.name)]);
    for (const f of [...(v.fields ?? []), ...(v.title ? [v.title] : []), ...(v.summary ? [v.summary] : [])]) {
      if (!declared.has(f)) out.push({ kind, message: `view names field ${f}, which ${kind} does not declare` });
    }
  }
  return out;
}
