import { describe, expect, it } from "vitest";
import type { Evaluation } from "../../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { rollup, type VerdictScope } from "@/model/status";
import { buildMapGraph } from "../useMapGraph";
import { candidateHalos, phenomeCounters } from "./overlayData";

const index = buildIndex(fixtureBundle());
const scope: VerdictScope = { source: "promoted", candidates: ["cand.a"] };
const ev = (criterion: string, over: Partial<Evaluation>): Evaluation => ({
  id: `${criterion}-${over.candidate ?? "cand.a"}`,
  candidate: "cand.a",
  hook: "h",
  criterion,
  ownerId: "o",
  subjectId: "s",
  targetRef: "t",
  execution: "completed",
  verdict: "pass",
  verifier: "v",
  startedAt: "2026-10-01T00:00:00Z",
  observations: [],
  limitations: [],
  provenance: {},
  ...over,
});

describe("phenomeCounters", () => {
  it("counts in-scope verdicts; queued and unpromoted passes stay not-run, never pass", () => {
    const evals = [
      ev("C.webapp.screen.people", { execution: "queued" }),
      ev("C.webapp.contact.save", { verdict: "fail" }),
      ev("C.webapp.contact.save", { candidate: "cand.other", verdict: "pass", startedAt: "2026-10-02T00:00:00Z" }),
    ];
    const c = phenomeCounters(rollup(index, "screen.people", evals, scope));
    const by = Object.fromEntries(c.map((x) => [x.key, x]));
    expect(by.pass).toMatchObject({ count: 0, tone: "pass" });
    expect(by.fail).toMatchObject({ count: 1, tone: "fail" });
    expect(by.notRun).toMatchObject({ count: 1, tone: "subtle", label: "not run" });
    expect(by.unknown!.tone).toBe("subtle");
    expect(by.stale!.tone).toBe("subtle");
    expect(c.map((x) => x.key)).toEqual(["pass", "fail", "unknown", "stale", "notRun"]);
  });

  it("a completed in-scope pass counts as pass", () => {
    const c = phenomeCounters(rollup(index, "screen.people", [ev("C.webapp.screen.people", {})], scope));
    expect(c.find((x) => x.key === "pass")!.count).toBe(1);
  });
});

describe("candidateHalos", () => {
  it("lifts touched descendants to the visible node and flags overlap", () => {
    const g = buildMapGraph(index, "screen.people");
    const halos = candidateHalos(index, g, new Map([
      ["cand.a", ["affordance.AddContactDialog.save", "entity.ContactRecord"]],
      ["cand.b", ["component.AddContactNameField", "nope"]],
    ]));
    expect(halos.get("component.AddContactDialog")).toEqual(["cand.a", "cand.b"]);
    expect(halos.get("entity.ContactRecord")).toEqual(["cand.a"]);
    expect(halos.has("component.SearchInput")).toBe(false);
  });
});
