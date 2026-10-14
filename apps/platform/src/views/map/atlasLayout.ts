import type { MapGraph, MapNode } from "./useMapGraph";

export interface AtlasBox { x: number; y: number; width: number; height: number }
export interface AtlasLayout { boxes: Record<string, AtlasBox>; width: number; height: number }

const ROW_WIDTH = 864;
const SCOPE_HEADER = 80;
const CONTEXT_WIDTH = 260;
const BOUNDARY_GAP = 32;
const CONTEXT_GAP = 16;
const MAIN_X = CONTEXT_WIDTH + BOUNDARY_GAP;
const SYSTEM_WIDTH = 560;
const SYSTEM_HEIGHT = 320;

/** Authored content determines the reading budget. Runtime state never enters this calculation. */
function budget(node: MapNode): { width: number; height: number } {
  const text = node.name.length + node.description.length;
  if (node.preview.length > 1 || text > 120) return { width: 432, height: 256 };
  if (node.preview.length || text > 40) return { width: 324, height: 192 };
  return { width: 216, height: 144 };
}

const ordered = (nodes: MapNode[]) => [...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pack balanced rows; stretch their reading budgets to meet the same shared right edge. */
function pack(nodes: MapNode[], width: number, top: number, boxes: Record<string, AtlasBox>): number {
  const pending = ordered(nodes).map((node) => ({ node, ...budget(node) }));
  let remainingWidth = pending.reduce((sum, n) => sum + n.width, 0);
  let remainingRows = Math.ceil(remainingWidth / width);
  let y = top;
  while (pending.length) {
    const goal = remainingWidth / remainingRows;
    const row: typeof pending = [];
    let rowWidth = 0;
    // Aim for balanced rows, keeping one tile for every remaining row.
    while (pending.length) {
      const next = pending[0]!;
      if (row.length && (rowWidth + next.width > width || pending.length <= remainingRows - 1 || Math.abs(rowWidth - goal) < Math.abs(rowWidth + next.width - goal))) break;
      row.push(pending.shift()!);
      rowWidth += next.width;
    }
    const height = Math.max(...row.map((n) => n.height));
    let x = 0;
    row.forEach((n, i) => {
      const tileWidth = i === row.length - 1 ? width - x : width * n.width / rowWidth;
      boxes[n.node.id] = { x, y, width: tileWidth, height };
      x += tileWidth;
    });
    y += height;
    remainingWidth -= rowWidth;
    remainingRows = Math.max(1, remainingRows - 1);
  }
  return y;
}

/** Context cards are independent of the containment mosaic and have their own reading room. */
function perimeter(nodes: MapNode[], x: number, boxes: Record<string, AtlasBox>): number {
  let y = 0;
  for (const node of ordered(nodes)) {
    const height = budget(node).height;
    boxes[node.id] = { x, y, width: CONTEXT_WIDTH, height };
    y += height + CONTEXT_GAP;
  }
  return nodes.length ? y - CONTEXT_GAP : 0;
}

/** Absolute canvas boxes, including the scope background. The focused System/scope has a
 * fixed main origin, with separate perimeter columns across an explicit boundary gap.
 * Only the actual containment mosaic shares dividers; runtime state never enters geometry. */
export function layoutAtlas(graph: MapGraph): AtlasLayout {
  const boxes: Record<string, AtlasBox> = {};
  if (!graph.nodes.length) return { boxes, width: 0, height: 0 };
  const scope = graph.nodes.find((n) => n.role === "scope");
  const system = !scope ? graph.nodes.find((n) => n.kind === "system" && n.role === "child") : undefined;
  if (system) {
    boxes[system.id] = { x: MAIN_X, y: 0, width: SYSTEM_WIDTH, height: SYSTEM_HEIGHT };
    const context = ordered(graph.nodes.filter((n) => n.id !== system.id));
    const leftHeight = perimeter(context.filter((_, i) => i % 2 === 0), 0, boxes);
    const rightHeight = perimeter(context.filter((_, i) => i % 2 === 1), MAIN_X + SYSTEM_WIDTH + BOUNDARY_GAP, boxes);
    return { boxes, width: SYSTEM_WIDTH + 2 * MAIN_X, height: Math.max(SYSTEM_HEIGHT, leftHeight, rightHeight) };
  }
  // Preserve a useful deterministic fallback for standalone synthetic or partial graphs.
  if (!scope) return { boxes, width: ROW_WIDTH, height: pack(graph.nodes, ROW_WIDTH, 0, boxes) };

  const children = graph.nodes.filter((n) => n.role === "child");
  const scopeBottom = children.length ? pack(children, ROW_WIDTH, SCOPE_HEADER, boxes) : budget(scope).height;
  for (const child of children) boxes[child.id]!.x += MAIN_X;
  boxes[scope.id] = { x: MAIN_X, y: 0, width: ROW_WIDTH, height: scopeBottom };
  const leftHeight = perimeter(graph.nodes.filter((n) => n.role === "external"), 0, boxes);
  const rightHeight = perimeter(graph.nodes.filter((n) => n.role === "outside"), MAIN_X + ROW_WIDTH + BOUNDARY_GAP, boxes);
  return { boxes, width: ROW_WIDTH + 2 * MAIN_X, height: Math.max(scopeBottom, leftHeight, rightHeight) };
}
