import type { CSSProperties } from "react";
import type { AtlasLayout } from "./atlasLayout";
export interface RelationDirections { top: number; right: number; bottom: number; left: number }
/** Maximum per side preserves opposite/parallel relations without vector cancellation. */
export function relationDirections(layout: Pick<AtlasLayout, "boxes" | "width" | "height">, edges: readonly { source: string; target: string }[]) {
  const result = new Map<string, RelationDirections>();
  for (const edge of edges) {
    const a = layout.boxes[edge.source], b = layout.boxes[edge.target];
    if (!a || !b || edge.source === edge.target) continue;
    const dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    if (!length) continue;
    for (const [id, sign] of [[edge.source, 1], [edge.target, -1]] as const) {
      const sides = result.get(id) ?? { top: 1, right: 1, bottom: 1, left: 1 };
      if (dx) { const side = dx * sign > 0 ? "right" : "left"; sides[side] = Math.max(sides[side], 1 + 2 * Math.abs(dx) / length); }
      if (dy) { const side = dy * sign > 0 ? "bottom" : "top"; sides[side] = Math.max(sides[side], 1 + 2 * Math.abs(dy) / length); }
      result.set(id, sides);
    }
  }
  return result;
}
export const relationBorderStyle = (sides?: RelationDirections): CSSProperties | undefined => sides ? {
  "--relation-top": `${sides.top}px`, "--relation-right": `${sides.right}px`, "--relation-bottom": `${sides.bottom}px`, "--relation-left": `${sides.left}px`,
} as CSSProperties : undefined;
