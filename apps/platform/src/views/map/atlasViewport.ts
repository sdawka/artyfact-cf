import type { AtlasLayout } from "./atlasLayout";
import type { MapGraph } from "./useMapGraph";

const FIT = { padding: 0.12, maxZoom: 1.1 };
export function fitViewport(w: number, h: number, cw: number, ch: number) {
  const pad = 1 + 2 * FIT.padding;
  const zoom = Math.max(0.15, Math.min(FIT.maxZoom, cw / (w * pad), ch / (h * pad)));
  return { x: (cw - w * zoom) / 2, y: (ch - h * zoom) / 2, zoom };
}
/** Preserve readable names; a phone pans the same authored mosaic instead of shrinking it to a thumbnail. */
export function initialAtlasViewport(layout: AtlasLayout, graph: MapGraph, width: number, height: number) {
  const scope = layout.boxes[graph.scope];
  const fitted = scope ? fitViewport(scope.width, scope.height, width, height) : fitViewport(layout.width, layout.height, width, height);
  if (scope) { fitted.x -= scope.x * fitted.zoom; fitted.y -= scope.y * fitted.zoom; }
  if (fitted.zoom >= 0.85) return fitted;
  const anchor = scope ?? layout.boxes[graph.nodes.find((node) => node.role === "child")?.id ?? ""];
  const x = layout.width * 0.85 <= width - 32 ? (width - layout.width * 0.85) / 2 : 16 - (anchor?.x ?? 0) * 0.85;
  return { x, y: 16 - (anchor?.y ?? 0) * 0.85, zoom: 0.85 };
}
