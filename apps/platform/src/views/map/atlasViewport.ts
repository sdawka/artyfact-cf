import type { AtlasLayout } from "./atlasLayout";
import type { MapGraph } from "./useMapGraph";

const DOCK_RESERVE = 72;
const EDGE = 16;
const CONTROLS = 64;
const FIT = { padding: 0.12, maxZoom: 1.1 };
export function fitViewport(w: number, h: number, cw: number, ch: number) {
  const pad = 1 + 2 * FIT.padding;
  const zoom = Math.max(0.15, Math.min(FIT.maxZoom, cw / (w * pad), ch / (h * pad)));
  return { x: (cw - w * zoom) / 2, y: (ch - h * zoom) / 2, zoom };
}
/** Preserve readable names: an entered scope fills the canvas width, the environment centres at the readable floor. */
export function initialAtlasViewport(layout: AtlasLayout, graph: MapGraph, width: number, height: number) {
  const scope = layout.boxes[graph.scope];
  // The legend and selection tray overlay the bottom of a wide canvas: fit above them so they never cover tiles.
  const fit = (h: number) => scope ? fitViewport(scope.width, scope.height, width, h) : fitViewport(layout.width, layout.height, width, h);
  let fitted = fit(height);
  if (width > 700 && (scope ? fitted.y + scope.height * fitted.zoom : fitted.y + layout.height * fitted.zoom) > height - DOCK_RESERVE) fitted = fit(Math.max(120, height - DOCK_RESERVE));
  if (scope) { fitted.x -= scope.x * fitted.zoom; fitted.y -= scope.y * fitted.zoom; }
  if (fitted.zoom >= 0.85) return scope ? clearContext(fitted, layout, graph, width) : fitted;
  if (scope) {
    // A tall scope fills the canvas width (readable floor 0.85, at most 1.1) and reads from its header down.
    // The zoom controls sit at the right edge: the scope stops short of them.
    const room = width - EDGE - CONTROLS;
    const zoom = Math.max(0.85, Math.min(FIT.maxZoom, room / scope.width));
    const x = EDGE + Math.max(0, (room - scope.width * zoom) / 2);
    return clearContext({ x: x - scope.x * zoom, y: EDGE - scope.y * zoom, zoom }, layout, graph, width);
  }
  const anchor = layout.boxes[graph.nodes.find((node) => node.role === "child")?.id ?? ""];
  const x = layout.width * 0.85 <= width - 32 ? (width - layout.width * 0.85) / 2 : 16 - (anchor?.x ?? 0) * 0.85;
  return { x, y: 16 - (anchor?.y ?? 0) * 0.85, zoom: 0.85 };
}

/**
 * The outside-scope column is either wholly on the canvas or starts at its right edge, never a sliver of cut-off tiles.
 * When it would peek in, the scope and the gap after it are fitted to the canvas and the column begins at the edge.
 */
function clearContext(view: { x: number; y: number; zoom: number }, layout: AtlasLayout, graph: MapGraph, width: number) {
  const outside = graph.nodes.filter((node) => node.role === "outside").map((node) => layout.boxes[node.id]).filter((box) => !!box);
  if (!outside.length) return view;
  const left = Math.min(...outside.map((box) => box.x)), right = Math.max(...outside.map((box) => box.x + box.width));
  const start = view.x + left * view.zoom;
  if (start >= width || view.x + right * view.zoom <= width - EDGE) return view;
  // Fit the scope and the gap after it into the canvas, then start the column exactly at the right edge.
  const scope = layout.boxes[graph.scope]!;
  const zoom = Math.max(0.85, Math.min(view.zoom, (width - EDGE) / (left - scope.x)));
  return { ...view, zoom, x: width - left * zoom };
}
