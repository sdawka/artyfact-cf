import { describe, expect, it } from "vitest";
import { approach, stepNumbers, stepVector } from "../src/interpolate";

describe("approach", () => {
  it("is exponential and frame-rate independent", () => {
    // One 100 ms step equals ten 10 ms steps.
    let a = 0;
    for (let i = 0; i < 10; i++) a = approach(a, 1, 0.01, 0.5);
    expect(a).toBeCloseTo(approach(0, 1, 0.1, 0.5), 10);
    // After one time constant, ~63% of the way.
    expect(approach(0, 1, 0.5, 0.5)).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it("snaps with tau <= 0 or a non-finite start", () => {
    expect(approach(0, 1, 0.016, 0)).toBe(1);
    expect(approach(Number.NaN, 2, 0.016, 1)).toBe(2);
  });
});

describe("stepNumbers", () => {
  it("eases every key, reports motion, then settles exactly on the target", () => {
    const now = { fill: 0.2, crackle: 0.5 };
    const target = { fill: 0.8, crackle: 0.5 };
    expect(stepNumbers(now, target, 0.016, 0.6)).toBe(true);
    expect(now.fill).toBeGreaterThan(0.2);
    expect(now.fill).toBeLessThan(0.8);
    expect(now.crackle).toBe(0.5);
    let frames = 0;
    while (stepNumbers(now, target, 0.016, 0.6)) frames++;
    expect(now.fill).toBe(0.8);
    // About 0.6 s × ln(0.6 / 1e-4) ≈ 5.2 s at 60 fps.
    expect(frames).toBeGreaterThan(200);
    expect(frames).toBeLessThan(400);
  });

  it("retargets mid-flight without a jump", () => {
    const now = { v: 0 };
    stepNumbers(now, { v: 1 }, 0.3, 0.6);
    const mid = now.v;
    stepNumbers(now, { v: 0 }, 0.016, 0.6);
    expect(Math.abs(now.v - mid)).toBeLessThan(0.02);
  });

  it("adopts unknown keys immediately", () => {
    const now: Record<string, number> = {};
    expect(stepNumbers(now, { x: 3 }, 0.016, 1)).toBe(false);
    expect(now.x).toBe(3);
  });
});

describe("stepVector", () => {
  it("eases each component and fills missing ones", () => {
    const v: number[] = [0];
    expect(stepVector(v, [1, 5], 0.1, 0.5)).toBe(true);
    expect(v[0]).toBeGreaterThan(0);
    expect(v[1]).toBe(5);
    expect(stepVector(v, [1, 5], 100, 0.5)).toBe(false);
    expect(v).toEqual([1, 5]);
  });
});
