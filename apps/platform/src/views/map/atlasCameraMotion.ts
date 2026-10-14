import type { Viewport } from "@xyflow/react";
import type { AtlasBox } from "./atlasLayout";
export const cameraDuration = (enabled: boolean, reduced: boolean, duration: number) => enabled && !reduced ? duration : 0;
export function anchoredViewport(box: AtlasBox, anchor: { x: number; y: number }, zoom: number): Viewport {
  zoom = Math.max(.15, Math.min(2, zoom));
  return { x: anchor.x - (box.x + box.width / 2) * zoom, y: anchor.y - (box.y + box.height / 2) * zoom, zoom };
}
export function readableLocateViewport(box: AtlasBox, width: number, height: number, currentZoom: number) {
  const fitted = Math.min((width - 48) / box.width, (height - 96) / box.height);
  return anchoredViewport(box, { x: width / 2, y: height / 2 }, Math.max(.85, Math.min(1.15, Math.max(currentZoom, fitted))));
}
/** Every asynchronous camera completion must still own the current sequence. */
export class CameraSequence {
  private sequence = 0;
  begin() { return ++this.sequence; }
  cancel() { ++this.sequence; }
  isCurrent(sequence: number) { return this.sequence === sequence; }
}
export interface AtlasTravel { historyKey?: string; source?: string; id: string; target: string; kind: "enter" | "up" | "locate"; focus?: string; sequence: number }
