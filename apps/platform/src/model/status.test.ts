import { describe, expect, it } from "vitest";
import type { Evaluation, SystemCommit } from "../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "./index";
import { emptyRollup, promotedCandidates, rollup, verdictOf, verdictScope, verdictTone, type VerdictScope } from "./status";

const ev = (over: Partial<Evaluation>): Evaluation => ({
  id: "e", candidate: "cand.1", criterion: "C.webapp.screen.people", hook: "semantic", ownerId: "thing.webapp",
  subjectId: "screen.people", targetRef: "artifact.webapp@abc", execution: "completed", verdict: "pass", verifier: "v",
  startedAt: "2026-10-01T00:00:00Z", observations: [], limitations: [], provenance: {}, ...over,
});
const commit = (id: string, candidates: string[]): SystemCommit => ({
  id, parent: null, genomeCommit: "g", manifest: [], evolutions: [], candidates, rejected: [], evidence: [],
  decision: { by: "admin", policy: "p", rationale: "r", at: "2026-10-01T00:00:00Z" },
});
const only = (...candidates: string[]): VerdictScope => ({ source: "selected", candidates });
const ix = buildIndex(fixtureBundle());
const C = "C.webapp.screen.people";

describe("verdictOf", () => {
  it("is not-run when there is no evaluation, never pass", () => {
    expect(verdictOf(C, [], only("cand.1"))).toBe("not-run");
  });
  it("does not count a pass that did not complete", () => {
    expect(verdictOf(C, [ev({ execution: "not-run" })], only("cand.1"))).toBe("not-run");
    expect(verdictOf(C, [ev({ execution: "queued" })], only("cand.1"))).toBe("not-run");
    expect(verdictOf(C, [ev({ execution: "error" })], only("cand.1"))).toBe("unknown");
  });
  it("uses the latest in-scope evaluation", () => {
    const evals = [
      ev({ id: "a", verdict: "fail", startedAt: "2026-10-01T00:00:00Z" }),
      ev({ id: "b", verdict: "pass", startedAt: "2026-10-02T00:00:00Z" }),
      ev({ id: "c", verdict: "fail", candidate: "cand.2", startedAt: "2026-10-03T00:00:00Z" }),
    ];
    expect(verdictOf(C, evals, only("cand.1"))).toBe("pass");
    expect(verdictOf(C, evals, only("cand.1", "cand.2"))).toBe("fail");
  });
  it("never shows an unpromoted candidate's pass on the canonical view", () => {
    const evals = [ev({ candidate: "cand.unpromoted", verdict: "pass" })];
    const canonical = verdictScope([], [commit("sc.1", ["cand.old"])], "head");
    expect(canonical).toEqual({ source: "promoted", candidates: ["cand.old"] });
    expect(verdictOf(C, evals, canonical)).toBe("not-run");
    expect(verdictOf(C, evals, verdictScope([], [], "head"))).toBe("not-run");
    expect(verdictOf(C, evals, verdictScope(["cand.unpromoted"], [], "head"))).toBe("pass");
  });
  it("folds every hook's row like the gate: a failing model-rules row and a later passing system-one row is fail", () => {
    const rules = ev({ id: "r", hook: "hook.system.topology", verdict: "fail", startedAt: "2026-10-01T00:00:00Z" });
    const semantic = ev({ id: "s", hook: "hook.system.topology.semantic", verdict: "pass", startedAt: "2026-10-01T00:00:05Z" });
    expect(verdictOf(C, [rules, semantic], only("cand.1"))).toBe("fail");
    expect(verdictOf(C, [semantic, rules], only("cand.1"))).toBe("fail");
    expect(verdictOf(C, [{ ...rules, verdict: "pass" }, semantic], only("cand.1"))).toBe("pass");
    // A hook that has not run keeps the criterion from passing, unless it never runs before promotion.
    const pending = ev({ id: "p", hook: "hook.deploy", execution: "not-run", verdict: "unknown" });
    expect(verdictOf(C, [semantic, pending], only("cand.1"))).toBe("not-run");
    expect(verdictOf(C, [semantic, pending], only("cand.1"), new Set(["hook.deploy"]))).toBe("pass");
    expect(verdictOf(C, [semantic, ev({ id: "x", hook: "hook.x", execution: "error" })], only("cand.1"))).toBe("unknown");
  });
  it("passes stale and waived through", () => {
    expect(verdictOf(C, [ev({ verdict: "stale" })], only("cand.1"))).toBe("stale");
    expect(verdictOf(C, [ev({ verdict: "waived" })], only("cand.1"))).toBe("waived");
  });
  it("maps only pass to the success tone", () => {
    expect(verdictTone("pass")).toBe("pass");
    expect(verdictTone("fail")).toBe("fail");
    for (const v of ["unknown", "stale", "not-run", "waived"] as const) expect(verdictTone(v)).toBe("subtle");
  });
});

describe("verdict scope", () => {
  const history = [commit("sc.3", ["cand.c"]), commit("sc.2", ["cand.b"]), commit("sc.1", ["cand.a"])];
  it("collects candidates promoted into a revision and its ancestors", () => {
    expect(promotedCandidates(history, "head")).toEqual(["cand.c", "cand.b", "cand.a"]);
    expect(promotedCandidates(history, "sc.2")).toEqual(["cand.b", "cand.a"]);
    expect(promotedCandidates(history, "nope")).toEqual([]);
  });
  it("scopes a candidate revision to itself", () => {
    expect(verdictScope([], history, "cand.x")).toEqual({ source: "revision", candidates: ["cand.x"] });
  });
});

describe("rollup", () => {
  const count = (id: string) =>
    new Set(ix.descendants(id).flatMap((d) => ix.criteriaFor(d).filter((c) => !c.deferred).map((c) => c.id))).size;
  it("counts criteria on the node and its descendants; nothing evaluated is not-run", () => {
    expect(rollup(ix, "screen.people", [], only())).toEqual({ ...emptyRollup(), notRun: count("screen.people") });
  });
  it("counts stale separately from pass, within scope", () => {
    const evals = [
      ev({ criterion: "C.webapp.screen.people", verdict: "stale" }),
      ev({ criterion: "C.webapp.contact.save", verdict: "pass" }),
    ];
    const n = count("thing.webapp");
    expect(rollup(ix, "thing.webapp", evals, only("cand.1"))).toEqual({ ...emptyRollup(), stale: 1, pass: 1, notRun: n - 2 });
    expect(rollup(ix, "thing.webapp", evals, only())).toEqual({ ...emptyRollup(), notRun: n });
  });
});
