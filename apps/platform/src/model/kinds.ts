import type { AnyKind } from "./types";

export const VIEWS = ["overview", "map", "journeys", "theory", "work", "evaluations", "history"] as const;
export type ViewName = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewName, string> = {
  overview: "Overview",
  map: "Map",
  journeys: "Journeys",
  theory: "Theory",
  work: "Work",
  evaluations: "Evaluations",
  history: "History",
};

export interface KindInfo {
  /** One character shown before the name; never the only signal (always paired with the label or name). */
  glyph: string;
  label: string;
}

export const KINDS: Record<AnyKind, KindInfo> = {
  system: { glyph: "◎", label: "System" },
  thing: { glyph: "◉", label: "Thing" },
  section: { glyph: "▤", label: "Section" },
  screen: { glyph: "▭", label: "Screen" },
  component: { glyph: "▫", label: "Component" },
  affordance: { glyph: "▸", label: "Affordance" },
  route: { glyph: "/", label: "Route" },
  entity: { glyph: "▦", label: "Entity" },
  field: { glyph: "·", label: "Field" },
  operation: { glyph: "ƒ", label: "Operation" },
  policy: { glyph: "§", label: "Policy" },
  binding: { glyph: "⌁", label: "Binding" },
  grouping: { glyph: "⬚", label: "Grouping" },
  external: { glyph: "◌", label: "External" },
  purpose: { glyph: "◇", label: "Purpose" },
  claim: { glyph: "△", label: "Claim" },
  requirement: { glyph: "≡", label: "Requirement" },
  feature: { glyph: "◆", label: "Feature" },
  commitment: { glyph: "⊕", label: "Commitment" },
  criterion: { glyph: "✓", label: "Criterion" },
  hook: { glyph: "⚲", label: "Hook" },
  journey: { glyph: "⇢", label: "Journey" },
  step: { glyph: "→", label: "Step" },
  evolution: { glyph: "↗", label: "Evolution" },
  realization: { glyph: "⎇", label: "Realization" },
  artifact: { glyph: "▣", label: "Artifact" },
  template: { glyph: "⧉", label: "Template" },
};

const UNKNOWN: KindInfo = { glyph: "?", label: "Unknown" };

export const kindInfo = (kind: string | undefined): KindInfo =>
  (kind !== undefined && (KINDS as Record<string, KindInfo>)[kind]) || UNKNOWN;

/** The view that best shows an object of this kind (CommandPalette, "Open in" defaults). */
export function bestViewFor(kind: string | undefined): ViewName {
  switch (kind) {
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
    case "realization":
      return "work";
    case "criterion":
    case "hook":
      return "evaluations";
    default:
      return "map";
  }
}
