import { describe, expect, it } from "vitest";
import type { schema } from "@artyfact/model";
import type { SubmissionContext } from "../../worker/hooks/contract";
import { modelRulesHook } from "../../worker/hooks/model-checks";
import { loadGenome, modelRules } from "../../worker/hooks/model-rules";
import { BASE, COMMIT, miniGenome } from "./fixtures";

const hook = (inputs: Record<string, string>): schema.AssayHook => ({
  id: "hook.x", version: 1, assay: "x", criteria: ["C.system.promotion"], tier: "basic", engine: "model-rules", targetKind: "model",
  triggers: ["submission"], inputs, timeoutMs: 60000, costTier: "free", binding: "bound",
});

const env = (over: Partial<SubmissionContext> = {}) => {
  const ctx: SubmissionContext = {
    systemId: "s", genomeCommit: BASE, genomeFiles: miniGenome(), tree: [], permittedPaths: ["src/**"], protectedPaths: [], openCandidates: [],
    candidate: { id: "c", realizationId: "r", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE, changedPaths: ["src/a.ts"], changedNodes: ["screen.people"] },
    ...over,
  };
  return { ctx, base: loadGenome(miniGenome(), BASE), rules: () => modelRules({ files: miniGenome(), revision: BASE }) };
};

describe("model-rules checks", () => {
  it("only errored parts → execution error", () => {
    const o = modelRulesHook(env(), hook({ check: "bogus" }));
    expect(o).toMatchObject({ execution: "error", verdict: "unknown" });
  });

  it("mixed errored and completed parts → completed, unknown, with a limitation naming the errored part", () => {
    const o = modelRulesHook(env(), hook({ check: "scope-authorized,bogus" }));
    expect(o).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(o.limitations.join(" ")).toContain("bogus errored");
  });

  it("only not-run parts → not-run", () => {
    const o = modelRulesHook(env(), hook({ check: "manifest-exact,evidence-fresh" }));
    expect(o).toMatchObject({ execution: "not-run", verdict: "unknown" });
  });
});
