/**
 * Journeys layout. The shared elk helper (`@/graph/elk`, layered RIGHT) decides each step's column;
 * the lane (actor | system | external) decides its row. elk partitions order layers, not rows, so
 * lane rows are assigned here.
 */
import { LAYERED_RIGHT, layoutGraph } from "@/graph/elk";
export const LANES = ["actor", "system", "external"] as const;
export type Lane = (typeof LANES)[number];

export const NODE_W = 184;
export const NODE_H = 92;
export const DECISION_W = 200;
export const DECISION_H = 116;
export const COL_GAP = 48;
export const ROW_GAP = 20;
export const LANE_PAD = 24;
export const COLUMN_PITCH = DECISION_W + COL_GAP;
export const LANE_LABEL_W = 96;
/** A lane with no steps collapses to a slim band that says so. */
export const EMPTY_LANE_H = 40;

export interface LayoutNode {
  id: string;
  lane: Lane;
  w: number;
  h: number;
}
export interface LayoutEdge {
  source: string;
  target: string;
}

/** Column x per node from longest-path depth. Used until elk answers, and as the test fallback. */
export function depthColumns(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, number> {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const s = depth.get(e.source);
      const t = depth.get(e.target);
      if (s === undefined || t === undefined || e.source === e.target) continue;
      if (t < s + 1 && s + 1 < nodes.length) {
        depth.set(e.target, s + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return new Map([...depth].map(([id, d]) => [id, d * COLUMN_PITCH]));
}

/** Column x per node from the shared elk layout (layered, RIGHT), snapped to a uniform column pitch. */
export async function elkColumns(nodes: LayoutNode[], edges: LayoutEdge[]): Promise<Map<string, number>> {
  const result = await layoutGraph({
    nodes: nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
    edges: edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target })),
    layoutOptions: {
      ...LAYERED_RIGHT,
      "elk.hierarchyHandling": "SEPARATE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(COL_GAP),
      "elk.spacing.nodeNode": String(ROW_GAP),
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
  });
  // Snap layers to a uniform pitch so differently sized nodes never overlap.
  const xs = nodes.map((n) => Math.round(result.nodes[n.id]?.x ?? 0));
  const layers = [...new Set(xs)].sort((x, y) => x - y);
  return new Map(nodes.map((n, i) => [n.id, layers.indexOf(xs[i]!) * COLUMN_PITCH]));
}

export interface LaneBand {
  lane: Lane;
  y: number;
  height: number;
  /** No step sits in this lane. */
  empty: boolean;
}
export interface Placement {
  positions: Map<string, { x: number; y: number }>;
  bands: LaneBand[];
  width: number;
  height: number;
}

/** Puts each node in its lane's band; nodes that would overlap in a lane stack into extra rows. */
export function placeInLanes(nodes: LayoutNode[], columns: Map<string, number>): Placement {
  const positions = new Map<string, { x: number; y: number }>();
  const bands: LaneBand[] = [];
  let y = 0;
  let width = 0;
  for (const lane of LANES) {
    const inLane = nodes.filter((n) => n.lane === lane).sort((a, b) => (columns.get(a.id) ?? 0) - (columns.get(b.id) ?? 0));
    const rowEnds: number[] = [];
    const rowOf = new Map<string, number>();
    for (const n of inLane) {
      const x = columns.get(n.id) ?? 0;
      let row = rowEnds.findIndex((end) => end + COL_GAP / 2 <= x);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = x + n.w;
      rowOf.set(n.id, row);
      width = Math.max(width, x + n.w);
    }
    const rows = Math.max(rowEnds.length, 1);
    const rowH = DECISION_H + ROW_GAP;
    const height = inLane.length === 0 ? EMPTY_LANE_H : LANE_PAD * 2 + rows * rowH - ROW_GAP;
    for (const n of inLane) {
      const row = rowOf.get(n.id) ?? 0;
      positions.set(n.id, {
        x: (columns.get(n.id) ?? 0) + LANE_LABEL_W,
        y: y + LANE_PAD + row * rowH + (DECISION_H - n.h) / 2,
      });
    }
    bands.push({ lane, y, height, empty: inLane.length === 0 });
    y += height;
  }
  return { positions, bands, width: width + LANE_LABEL_W, height: y };
}
