/**
 * Local elk wrapper for the Journeys canvas. elk's layered algorithm (direction RIGHT) decides each
 * step's column; the lane (actor | system | external) decides its row. elk partitions order layers,
 * not rows, so lane rows are assigned here. Swap for `@/graph/elk` once slice 2.1 lands.
 */
export const LANES = ["actor", "system", "external"] as const;
export type Lane = (typeof LANES)[number];

export const NODE_W = 208;
export const NODE_H = 76;
export const DECISION_W = 232;
export const DECISION_H = 116;
export const COL_GAP = 56;
export const ROW_GAP = 20;
export const LANE_PAD = 24;
export const LANE_LABEL_W = 96;

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
  return new Map([...depth].map(([id, d]) => [id, d * (NODE_W + COL_GAP)]));
}

/** Column x per node from elk's layered layout (RIGHT). Loaded lazily; rejects if elk fails. */
export async function elkColumns(nodes: LayoutNode[], edges: LayoutEdge[]): Promise<Map<string, number>> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const ids = new Set(nodes.map((n) => n.id));
  const graph = await new ELK().layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(COL_GAP),
      "elk.spacing.nodeNode": String(ROW_GAP),
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  });
  return new Map((graph.children ?? []).map((c) => [c.id, c.x ?? 0]));
}

export interface LaneBand {
  lane: Lane;
  y: number;
  height: number;
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
    const height = LANE_PAD * 2 + rows * rowH - ROW_GAP;
    for (const n of inLane) {
      const row = rowOf.get(n.id) ?? 0;
      positions.set(n.id, {
        x: (columns.get(n.id) ?? 0) + LANE_LABEL_W,
        y: y + LANE_PAD + row * rowH + (DECISION_H - n.h) / 2,
      });
    }
    bands.push({ lane, y, height });
    y += height;
  }
  return { positions, bands, width: width + LANE_LABEL_W, height: y };
}
