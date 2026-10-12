import { describe, expect, it } from "vitest";
import type { BuildStatus } from "../../../shared/api";
import { cardSignals, type CardSummary } from "./signifiers";

const base: CardSummary = {
  systemId: "s", title: "S", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "",
};
const keys = (s: CardSummary) => cardSignals(s).chips.map((c) => `${c.key}:${c.tone}`);

describe("cardSignals", () => {
  it("handles a summary from a server without iteration-2 fields", () => {
    expect(cardSignals(base)).toEqual({ state: undefined, chips: [expect.objectContaining({ key: "deploy", label: "not deployed, unknown", tone: "neutral" })] });
  });

  it("awaiting review wins over evolving, which wins over not built", () => {
    expect(cardSignals({ ...base, signifiers: ["not-fully-built"] }).state).toBe("unbuilt");
    expect(cardSignals({ ...base, signifiers: ["evolving", "not-fully-built"] }).state).toBe("evolving");
    expect(cardSignals({ ...base, signifiers: ["evolving", "awaiting-admin", "not-fully-built"] }).state).toBe("attention");
  });

  it("maps deploy states and build status to tones; only a passed build is pass", () => {
    expect(keys({ ...base, deployState: "live" })).toEqual(["deploy:neutral"]);
    expect(keys({ ...base, deployState: "behind" })).toEqual(["deploy:attention"]);
    expect(keys({ ...base, deployState: "failed" })).toEqual(["deploy:fail"]);
    const build = (status: BuildStatus) => cardSignals({ ...base, latestBuild: { id: "b", status, kind: "preview", commit: "c" } }).chips.find((c) => c.key === "build")!.tone;
    expect((["queued", "running", "passed", "failed", "error"] as const).map(build)).toEqual(["neutral", "neutral", "pass", "fail", "fail"]);
  });

  it("uses counts in labels", () => {
    const labels = cardSignals({
      ...base,
      signifiers: ["evolving", "pending-realization", "awaiting-admin", "observed"],
      realizationCounts: { evolving: 2, pending: 1, awaitingAdmin: 3 },
    }).chips.map((c) => c.label);
    expect(labels).toEqual(["2 realizations evolving", "1 pending realization", "3 awaiting review", "not deployed, unknown", "observed"]);
  });
});
