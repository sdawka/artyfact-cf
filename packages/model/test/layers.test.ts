import { describe, expect, it } from "vitest";
import { layerOf } from "../src/layers.ts";

describe("layerOf", () => {
  it("reads the layer off targetKind", () => {
    expect(layerOf({ targetKind: "model" })).toBe("genome");
    expect(layerOf({ targetKind: "artifact" })).toBe("realization");
    expect(layerOf({ targetKind: "runtime" })).toBe("phenome");
    expect(layerOf({ targetKind: "observation" })).toBe("phenome");
  });
  it("falls back to the hooks' engines, the outermost layer winning", () => {
    const c = { targetKind: undefined as unknown as "model" };
    expect(layerOf(c, [{ engine: "manifest" }])).toBe("realization");
    expect(layerOf(c, [{ engine: "model-rules" }, { engine: "system-one" }])).toBe("genome");
    expect(layerOf(c, [{ engine: "diff" }, { engine: "http" }])).toBe("phenome");
    expect(layerOf(c, [])).toBe("genome");
  });
});
