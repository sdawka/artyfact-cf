import type { EvolutionsResponse } from "../../../../shared/api";
import type { ModelIndex } from "@/model/index";
import type { Rollup } from "@/model/status";
import type { MapGraph } from "../useMapGraph";

export interface PhenomeCounter {
  key: "pass" | "fail" | "unknown" | "stale" | "notRun";
  label: string;
  glyph: string;
  count: number;
  /** Only pass is green; fail is danger; the rest are subtle grey. */
  tone: "pass" | "fail" | "subtle";
}

/** The five Phenome counters for a node's rollup (waived is left out). */
export function phenomeCounters(r: Rollup): PhenomeCounter[] {
  return [
    { key: "pass", label: "pass", glyph: "✓", count: r.pass, tone: "pass" },
    { key: "fail", label: "fail", glyph: "✕", count: r.fail, tone: "fail" },
    { key: "unknown", label: "unknown", glyph: "?", count: r.unknown, tone: "subtle" },
    { key: "stale", label: "stale", glyph: "≈", count: r.stale, tone: "subtle" },
    { key: "notRun", label: "not run", glyph: "○", count: r.notRun, tone: "subtle" },
  ];
}

/**
 * Visible node id -> candidate ids touching it (directly or through a descendant), in candidate
 * order. Two or more entries mean overlap.
 */
export function candidateHalos(index: ModelIndex, graph: MapGraph, touches: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [candidate, subjects] of touches) {
    const hit = new Set<string>();
    for (const s of subjects) {
      const visible = index.path(s).reverse().find((e) => graph.ids.has(e.id) && (e.id !== graph.scope || e.id === s));
      if (visible) hit.add(visible.id);
    }
    for (const id of hit) (out.get(id) ?? out.set(id, []).get(id)!).push(candidate);
  }
  return out;
}

/** Realizations of evolutions affecting `id` (same rule as `useRealizationsTouching`), for accessible names. */
export function realizationCount(board: EvolutionsResponse | undefined, id: string): number {
  if (!board) return 0;
  const evolutions = new Set(board.evolutions.filter((e) => e.affectedNodes.includes(id)).map((e) => e.id));
  return board.realizations.filter((r) => evolutions.has(r.evolution)).length;
}
