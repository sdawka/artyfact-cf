import { kindViews, type KindViews } from "@/model/kinds";
import { estimate, TILE, tileMetrics, type Measure, type TileMetrics } from "./atlasTile";
import type { MapGraph, MapNode } from "./useMapGraph";

export interface AtlasBox { x: number; y: number; width: number; height: number }
export interface AtlasLayout {
  boxes: Record<string, AtlasBox>;
  /** What each tile shows (line budgets, the clamped purpose), computed with its box so the two always agree. */
  metrics: Record<string, TileMetrics>;
  width: number;
  height: number;
}
export interface AtlasLayoutOptions {
  /** Kind labels size the "inside" summary; bare defaults without them. */
  views?: KindViews;
  /** Text widths with the page's fonts (`useTextMeasure`); a per-character estimate without it. */
  measure?: Measure;
  /** The most tile columns the canvas shows at the readable zoom floor (one on a phone). Defaults to six. */
  maxColumns?: number;
}

/** The scope frame's own header (kind tab and name) and its inner padding around the tiles. */
export const SCOPE_HEADER = 72;
export const SCOPE_PAD = 16;
const BOUNDARY_GAP = 32;
const CONTEXT_GAP = 72;
const MAX_COLUMNS = 6;
/** Target landscape proportion for a scope's tile area, near the canvas on a laptop. */
const ASPECT = 1.6;
const EMPTY_SCOPE = 72;

const ordered = (nodes: MapNode[]) => [...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Enough columns for a landscape block, never more columns than tiles or than the canvas shows. */
function columnsFor(heights: number[], maxColumns: number): number {
  const cap = Math.max(1, Math.min(MAX_COLUMNS, maxColumns, heights.length));
  const total = heights.reduce((sum, h) => sum + h + TILE.gap, 0);
  const ideal = Math.round(Math.sqrt(ASPECT * total / (TILE.width + TILE.gap)));
  return Math.max(Math.min(2, cap), Math.min(cap, ideal));
}

/** Columns a canvas `width` px wide shows at the readable zoom floor (0.85), clear of its edge and zoom controls (atlasViewport). */
export function columnsForCanvas(width: number): number {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(((width - 80) / 0.85 - 2 * SCOPE_PAD + TILE.gap) / (TILE.width + TILE.gap))));
}

/** Masonry: each tile, in id order, drops into the shortest column (leftmost on a tie). Returns the block's size. */
function masonry(nodes: MapNode[], heights: Map<string, number>, columns: number, x0: number, y0: number, boxes: Record<string, AtlasBox>) {
  const bottoms = Array.from({ length: columns }, () => y0);
  for (const node of nodes) {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const height = heights.get(node.id)!;
    boxes[node.id] = { x: x0 + column * (TILE.width + TILE.gap), y: bottoms[column]!, width: TILE.width, height };
    bottoms[column]! += height + TILE.gap;
  }
  return { width: columns * TILE.width + (columns - 1) * TILE.gap, height: Math.max(...bottoms) - TILE.gap - y0 };
}

/** One perimeter column of content-sized tiles. */
function perimeter(nodes: MapNode[], heights: Map<string, number>, x: number, boxes: Record<string, AtlasBox>): number {
  let y = 0;
  for (const node of ordered(nodes)) {
    const height = heights.get(node.id)!;
    boxes[node.id] = { x, y, width: TILE.width, height };
    y += height + TILE.gap;
  }
  return nodes.length ? y - TILE.gap : 0;
}

/** Absolute canvas boxes, including the scope frame. Tiles size to their content (`atlasTile`) and pack as masonry inside
 * the frame; outside-System actors sit in a column left of it and outside-scope context right of it, each only when it
 * has something to hold. Selection, connection visibility, Details and layer overlays never enter geometry. */
export function layoutAtlas(graph: MapGraph, options: AtlasLayoutOptions = {}): AtlasLayout {
  const boxes: Record<string, AtlasBox> = {};
  if (!graph.nodes.length) return { boxes, metrics: {}, width: 0, height: 0 };
  const views = options.views ?? kindViews(undefined);
  const maxColumns = options.maxColumns ?? MAX_COLUMNS;
  const scope = graph.nodes.find((n) => n.role === "scope");
  const system = !scope ? graph.nodes.find((n) => n.kind === "system" && n.role === "child") : undefined;
  const measure = options.measure ?? estimate;
  // On a phone the System takes one column's width, like every other tile.
  const systemWidth = maxColumns > 1 ? TILE.systemWidth : TILE.width;
  const metrics = Object.fromEntries(graph.nodes.filter((n) => n.role !== "scope").map((n) => [n.id, tileMetrics(n, views, n === system ? systemWidth : TILE.width, measure)]));
  const heights = new Map(Object.entries(metrics).map(([id, m]) => [id, m.height]));
  const sideX = TILE.width + BOUNDARY_GAP;

  if (system) {
    // The System is central at a fixed origin; declared actors alternate into the two perimeter columns.
    const height = heights.get(system.id)!;
    boxes[system.id] = { x: sideX, y: 0, width: systemWidth, height };
    const context = ordered(graph.nodes.filter((n) => n.id !== system.id));
    const leftHeight = perimeter(context.filter((_, i) => i % 2 === 0), heights, 0, boxes);
    const rightHeight = perimeter(context.filter((_, i) => i % 2 === 1), heights, sideX + systemWidth + BOUNDARY_GAP, boxes);
    return { boxes, metrics, width: systemWidth + 2 * sideX, height: Math.max(height, leftHeight, rightHeight) };
  }
  // A deterministic fallback for standalone synthetic or partial graphs.
  if (!scope) {
    const nodes = ordered(graph.nodes);
    const block = masonry(nodes, heights, columnsFor(nodes.map((n) => heights.get(n.id)!), maxColumns), 0, 0, boxes);
    return { boxes, metrics, width: block.width, height: block.height };
  }

  const children = ordered(graph.nodes.filter((n) => n.role === "child"));
  const externals = graph.nodes.filter((n) => n.role === "external");
  const outside = graph.nodes.filter((n) => n.role === "outside");
  const mainX = externals.length ? sideX : 0;
  let width: number, height: number;
  if (children.length) {
    const columns = columnsFor(children.map((n) => heights.get(n.id)!), maxColumns);
    const block = masonry(children, heights, columns, mainX + SCOPE_PAD, SCOPE_HEADER, boxes);
    width = block.width + 2 * SCOPE_PAD;
    height = SCOPE_HEADER + block.height + SCOPE_PAD;
  } else {
    const columns = Math.min(2, maxColumns);
    width = columns * TILE.width + (columns - 1) * TILE.gap + 2 * SCOPE_PAD;
    height = SCOPE_HEADER + EMPTY_SCOPE;
  }
  boxes[scope.id] = { x: mainX, y: 0, width, height };
  const leftHeight = perimeter(externals, heights, 0, boxes);
  // Outside-scope context sits a wider gap away, so a scope fitted beside it stays clear of the zoom controls.
  const rightX = mainX + width + CONTEXT_GAP;
  const rightHeight = perimeter(outside, heights, rightX, boxes);
  return { boxes, metrics, width: outside.length ? rightX + TILE.width : mainX + width, height: Math.max(height, leftHeight, rightHeight) };
}
