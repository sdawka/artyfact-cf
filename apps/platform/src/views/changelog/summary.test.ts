import { describe, expect, it } from "vitest";
import type { ChangelogRow } from "../../../shared/api";
import { evolutionOptions, summaryLine } from "./summary";

describe("summaryLine", () => {
  it("formats node, file and criteria counts", () => {
    expect(summaryLine({ nodesAdded: 2, nodesChanged: 1, nodesRemoved: 0, filesChanged: 4, criteriaAffected: 3 })).toBe("nodes +2 ~1 −0 · 4 files · 3 criteria");
  });
  it("uses the singular for one", () => {
    expect(summaryLine({ nodesAdded: 0, nodesChanged: 0, nodesRemoved: 1, filesChanged: 1, criteriaAffected: 1 })).toBe("nodes +0 ~0 −1 · 1 file · 1 criterion");
  });
});

describe("evolutionOptions", () => {
  it("lists each Evolution once in first-seen order", () => {
    const rows = [
      { evolutions: [{ id: "evolution.2", title: "B" }] },
      { evolutions: [{ id: "evolution.1", title: "A" }, { id: "evolution.2", title: "B" }] },
    ] as ChangelogRow[];
    expect(evolutionOptions(rows)).toEqual([{ id: "evolution.2", title: "B" }, { id: "evolution.1", title: "A" }]);
  });
});
