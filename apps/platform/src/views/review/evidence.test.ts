import { describe, expect, it } from "vitest";
import type { Evaluation } from "../../../shared/api";
import { criterionEvidence } from "./evidence";

const row = (criterion: string, hook: string, verdict: string, execution: string, at: string, candidate = "cand.1") =>
  ({ id: `${candidate}:${hook}:${criterion}:${at}`, candidate, criterion, hook, verdict, execution, startedAt: at, finishedAt: at }) as unknown as Evaluation;

describe("criterionEvidence", () => {
  it("lists each criterion once, folding its hooks and re-runs the way the gate does", () => {
    const out = criterionEvidence([
      row("C.system.topology", "hook.system.topology", "pass", "completed", "1"),
      row("C.system.topology", "hook.system.topology.semantic", "pass", "completed", "1"),
      row("C.system.purpose", "hook.system.purpose.model", "pass", "completed", "1"),
      row("C.system.purpose", "hook.system.purpose.outcome", "unknown", "not-run", "1"),
      row("C.webapp.exists", "hook.webapp.exists", "fail", "completed", "1"),
      row("C.webapp.exists", "hook.webapp.exists", "pass", "completed", "2"),
    ]);
    expect(out.map((r) => [r.criterion, r.verdict])).toEqual([
      ["C.system.topology", "pass"],
      // One hook passed, the other never ran: never green.
      ["C.system.purpose", "not-run"],
      // The later run of the same hook supersedes the earlier one.
      ["C.webapp.exists", "pass"],
    ]);
    expect(out[1]!.hooks).toEqual([
      { hook: "hook.system.purpose.model", verdict: "pass", execution: "completed" },
      { hook: "hook.system.purpose.outcome", verdict: "not-run", execution: "not-run" },
    ]);
    expect(out[2]!.hooks).toHaveLength(1);
  });

  it("keeps candidates apart and disregards not-run rows of hooks that only run after promotion", () => {
    const out = criterionEvidence([
      row("C.a", "hook.a", "pass", "completed", "1", "cand.1"),
      row("C.a", "hook.a", "fail", "completed", "1", "cand.2"),
      row("C.b", "hook.b", "pass", "completed", "1"),
      row("C.b", "hook.b.runtime", "unknown", "not-run", "1"),
    ], new Set(["hook.b.runtime"]));
    expect(out.map((r) => [r.candidate, r.criterion, r.verdict])).toEqual([["cand.1", "C.a", "pass"], ["cand.2", "C.a", "fail"], ["cand.1", "C.b", "pass"]]);
  });
});
