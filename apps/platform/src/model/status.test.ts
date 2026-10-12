import { describe, expect, it } from "vitest";
import type { Evaluation } from "../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "./index";
import { emptyRollup, rollup, verdictOf, verdictTone } from "./status";

const ev = (over: Partial<Evaluation>): Evaluation => ({
  id: "e", candidate: "cand.1", criterion: "C.webapp.screen.people", hook: "semantic", execution: "completed",
  verdict: "pass", observations: null, verifier: "v", at: "2026-10-01T00:00:00Z", ...over,
});
const ix = buildIndex(fixtureBundle());

describe("verdictOf", () => {
  it("is not-run when there is no evaluation, never pass", () => {
    expect(verdictOf("C.webapp.screen.people", [])).toBe("not-run");
  });
  it("does not count a pass that did not complete", () => {
    expect(verdictOf("C.webapp.screen.people", [ev({ execution: "not-run" })])).toBe("not-run");
    expect(verdictOf("C.webapp.screen.people", [ev({ execution: "errored" })])).toBe("unknown");
    expect(verdictOf("C.webapp.screen.people", [ev({ execution: "timed-out" })])).toBe("unknown");
  });
  it("uses the latest evaluation and honours the candidate filter", () => {
    const evals = [
      ev({ id: "a", verdict: "fail", at: "2026-10-01T00:00:00Z" }),
      ev({ id: "b", verdict: "pass", at: "2026-10-02T00:00:00Z" }),
      ev({ id: "c", verdict: "fail", candidate: "cand.2", at: "2026-10-03T00:00:00Z" }),
    ];
    expect(verdictOf("C.webapp.screen.people", evals)).toBe("fail");
    expect(verdictOf("C.webapp.screen.people", evals, { candidate: "cand.1" })).toBe("pass");
  });
  it("passes stale and waived through", () => {
    expect(verdictOf("C.webapp.screen.people", [ev({ verdict: "stale" })])).toBe("stale");
    expect(verdictOf("C.webapp.screen.people", [ev({ verdict: "waived" as Evaluation["verdict"] })])).toBe("waived");
  });
  it("maps only pass to the success tone", () => {
    expect(verdictTone("pass")).toBe("pass");
    expect(verdictTone("fail")).toBe("fail");
    for (const v of ["unknown", "stale", "not-run", "waived"] as const) expect(verdictTone(v)).toBe("subtle");
  });
});

describe("rollup", () => {
  it("counts criteria on the node and its descendants; nothing evaluated is not-run", () => {
    expect(rollup(ix, "screen.people", [])).toEqual({ ...emptyRollup(), notRun: 2 });
  });
  it("counts stale separately from pass", () => {
    const evals = [
      ev({ criterion: "C.webapp.screen.people", verdict: "stale" }),
      ev({ criterion: "C.webapp.contact.save", verdict: "pass" }),
    ];
    expect(rollup(ix, "screen.people", evals)).toEqual({ ...emptyRollup(), stale: 1, pass: 1 });
    expect(rollup(ix, "thing.webapp", evals)).toEqual({ ...emptyRollup(), stale: 1, pass: 1, notRun: 2 });
  });
});
