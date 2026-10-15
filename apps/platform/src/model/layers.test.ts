import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "./index";
import { groupByLayer, layerFor, layerFromModel } from "./layers";

describe("criteria layers", () => {
  const m = buildIndex(fixtureBundle());

  it("reads a criterion's layer off its targetKind in the loaded model", () => {
    expect(layerFromModel(m, "C.system.structure")).toBe("genome");
    expect(layerFromModel(m, "C.webapp.exists")).toBe("realization");
    expect(layerFromModel(m, "C.webapp.health")).toBe("phenome");
    expect(layerFromModel(m, "C.not.there")).toBeUndefined();
    expect(layerFromModel(m, "thing.webapp")).toBeUndefined();
  });

  it("prefers the server's layer map and falls back to the model", () => {
    expect(layerFor({ "C.webapp.exists": "phenome" }, m, "C.webapp.exists")).toBe("phenome");
    expect(layerFor(undefined, m, "C.webapp.exists")).toBe("realization");
    expect(layerFor(undefined, null, "C.webapp.exists")).toBeUndefined();
  });

  it("groups in Model, Realization, Running thing order, drops empty layers and keeps unplaced items last", () => {
    const groups = groupByLayer(["C.webapp.health", "C.unknown", "C.system.structure", "C.webapp.exists"], (c) => layerFromModel(m, c));
    expect(groups.map((g) => [g.layer, g.label, g.items])).toEqual([
      ["genome", "Model", ["C.system.structure"]],
      ["realization", "Realization", ["C.webapp.exists"]],
      ["phenome", "Running thing", ["C.webapp.health"]],
      ["unknown", "Layer unknown", ["C.unknown"]],
    ]);
    expect(groupByLayer([], () => undefined)).toEqual([]);
    expect(groupByLayer(["C.webapp.exists"], () => "realization").map((g) => g.layer)).toEqual(["realization"]);
  });
});
