import { describe, expect, it } from "vitest";
import { anchoredViewport, readableLocateViewport, CameraSequence, cameraDuration } from "./atlasCameraMotion";
const box = { x: 300, y: 80, width: 432, height: 192 };
describe("Atlas camera handoff", () => {
  it("places a new scope at the screen anchor and bounds zoom", () => {
    const v = anchoredViewport(box, { x: 160, y: 120 }, 8);
    expect(v.zoom).toBe(2);
    expect((box.x + box.width / 2) * v.zoom + v.x).toBe(160);
    expect((box.y + box.height / 2) * v.zoom + v.y).toBe(120);
  });
  it("frames a connected target at readable zoom rather than retaining a thumbnail camera", () => {
    const v = readableLocateViewport(box, 390, 600, .2);
    expect(v.zoom).toBeGreaterThanOrEqual(.85);
    expect(v.zoom).toBeLessThanOrEqual(1.15);
    expect((box.x + box.width / 2) * v.zoom + v.x).toBe(195);
  });
  it("invalidates obsolete completions on rapid travel or gesture interruption", () => {
    const sequence = new CameraSequence();
    const first = sequence.begin(), second = sequence.begin();
    expect(sequence.isCurrent(first)).toBe(false);
    expect(sequence.isCurrent(second)).toBe(true);
    sequence.cancel();
    expect(sequence.isCurrent(second)).toBe(false);
  });
  it("has immediate final states when effects are off or motion is reduced", () => {
    expect(cameraDuration(false, false, 280)).toBe(0);
    expect(cameraDuration(true, true, 280)).toBe(0);
    expect(cameraDuration(true, false, 280)).toBe(280);
  });
});
