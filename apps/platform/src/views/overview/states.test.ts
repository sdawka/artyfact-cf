import { describe, expect, it } from "vitest";
import type { Finding } from "@artyfact/model";
import { blockerAction, conformanceMeter, headCommit, outcomeMeter, readinessMeter, relativeTime, shortRev } from "./states";

const f = (level: Finding["level"], rule = "x.y"): Finding => ({
  level, rule, message: "m", facts: [], derivation: { relation: level, tuple: [rule], edb: false, children: [] },
});
const report = (findings: Finding[], extra: object = {}) =>
  ({ modelReadiness: { findings, blockers: [] }, computedAt: "2026-10-12T10:00:00Z", ...extra }) as never;

describe("readinessMeter", () => {
  it("counts errors, missing and warnings separately and ignores info", () => {
    const m = readinessMeter(report([f("error"), f("missing"), f("missing"), f("warning"), f("info")]));
    expect(m.segments.map((s) => [s.key, s.count])).toEqual([["error", 1], ["missing", 2], ["warning", 1]]);
    expect(m.headline).toBe("not actionable");
  });
  it("is actionable with warnings only", () => {
    expect(readinessMeter(report([f("warning")])).headline).toBe("actionable");
  });
  it("says unknown when the report is incomplete", () => {
    expect(readinessMeter(report([], { incomplete: true })).headline).toBe("unknown");
  });
});

describe("conformanceMeter", () => {
  it("buckets verdicts and never calls anything green without a pass", () => {
    const m = conformanceMeter(["pass", "fail", "not-run", "not-run", "stale", "waived"]);
    expect(Object.fromEntries(m.segments.map((s) => [s.key, s.count]))).toEqual({ pass: 1, fail: 1, unknown: 1, "not-run": 2 });
    expect(m.headline).toBe("1 of 5 pass");
  });
  it("reads not run when nothing has been evaluated", () => {
    expect(conformanceMeter(["not-run", "not-run"]).headline).toBe("not run");
  });
});

describe("outcomeMeter", () => {
  it("is the literal unknown with no observations", () => {
    const m = outcomeMeter([{ status: "unknown", deferred: false }, { status: "unknown", deferred: false }, { status: "unknown", deferred: true }]);
    expect(m.headline).toBe("unknown");
    expect(m.segments.find((s) => s.key === "unknown")?.count).toBe(2);
  });
  it("counts observed claims by status", () => {
    const m = outcomeMeter([{ status: "supported", deferred: false }, { status: "unknown", deferred: false }]);
    expect(m.headline).toBe("1 of 2 observed");
  });
});

describe("blockerAction", () => {
  it("maps rule families to a next action", () => {
    expect(blockerAction("coverage.hook")).toBe("Add a hook for the criterion.");
    expect(blockerAction("kit.unpinned")).toBe("Pin the kit under kits in the root node.yaml.");
    expect(blockerAction("no.such.rule")).toMatch(/derivation/);
  });
});

describe("helpers", () => {
  it("shortRev keeps names and shortens shas", () => {
    expect(shortRev("canonical")).toBe("canonical");
    expect(shortRev("0123456789abcdef0123")).toBe("0123456");
  });
  it("relativeTime handles epoch and invalid as unknown", () => {
    const now = Date.parse("2026-10-12T10:05:00Z");
    expect(relativeTime("2026-10-12T10:00:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("1970-01-01T00:00:00.000Z", now)).toBe("unknown");
    expect(relativeTime("nope", now)).toBe("unknown");
  });
});

describe("headCommit (the TopBar's head, design critique S5)", () => {
  const revisions = [
    { id: "head", kind: "head", label: "head (sc-1)" },
    { id: "sc-1-e12083f7", kind: "commit", label: "sc-1 Import" },
  ];
  it("prefers the model's own head", () => {
    expect(headCommit("sc-9-abc", revisions)).toBe("sc-9-abc");
  });
  it("resolves the revision picker's head label to the full System commit when the model has none", () => {
    expect(headCommit(undefined, revisions)).toBe("sc-1-e12083f7");
    expect(headCommit(null, [revisions[0]!])).toBe("sc-1");
  });
  it("is unknown only when neither source knows", () => {
    expect(headCommit(undefined, [])).toBeUndefined();
    expect(headCommit(undefined, [{ id: "head", kind: "head", label: "head" }])).toBeUndefined();
  });
});
