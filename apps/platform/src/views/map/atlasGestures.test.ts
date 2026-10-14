import { describe, expect, it } from "vitest";
import { depthGesture, newGesture } from "./atlasGestures";

describe("semantic depth gestures", () => {
  it("accumulates a deliberate threshold and emits one transition per gesture", () => {
    const state = newGesture();
    expect(depthGesture(state, 0.1)).toBeNull();
    expect(depthGesture(state, 0.14)).toBe("enter");
    expect(depthGesture(state, 1)).toBeNull();
    expect(depthGesture(state, -2)).toBeNull();
  });
  it("cancels jitter and supports outward gestures after release", () => {
    const state = newGesture();
    expect(depthGesture(state, 0.12)).toBeNull();
    expect(depthGesture(state, -0.12)).toBeNull();
    expect(depthGesture(state, -0.24)).toBe("up");
    expect(depthGesture(newGesture(), 0.24)).toBe("enter");
  });
});
