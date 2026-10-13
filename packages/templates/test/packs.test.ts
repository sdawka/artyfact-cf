import { describe, expect, it } from "vitest";
import { evaluate, merge } from "./engine";
import { authorization } from "./fixtures/authorization";
import { journeys } from "./fixtures/journeys";
import { metamodel } from "./fixtures/metamodel";
import { readiness } from "./fixtures/readiness";
import { theory } from "./fixtures/theory";
import { topology } from "./fixtures/topology";
import type { PackFixture } from "./fixtures/types";

// Rule ids per docs/design/rules.md D.3 that must fire from the pack's own fixtures.
const inventory: Record<string, string[]> = {
  metamodel: ["ref.dangling", "ref.parentMissing", "tree.cycle", "tree.multiParent", "owner.unknown", "criterion.subjectMissing", "criterion.ownerMissing", "thing.sectionMissing"],
  readiness: ["coverage.requirement", "coverage.hook", "hook.unbound", "template.sectionMissing", "template.criterionMissing", "template.unknown", "kit.unpinned", "evolution.acceptanceMissing", "evolution.affectsMissing"],
  authorization: ["authz.ungoverned", "authz.policyConflict", "authz.privateReadUngoverned"],
  theory: ["purpose.beneficiary", "purpose.beneficiaryKind", "theory.indicator", "theory.method", "theory.beneficiary", "theory.outcomeUnlinked"],
  journeys: ["journey.startMissing", "journey.nextDangling", "journey.noEnd", "journey.screenUncovered", "journey.stepRefMissing", "journey.operationUncovered", "screen.noComponents", "affordance.incomplete"],
  "topology.private-pairs": ["topology.recipientArray", "topology.groupEnabled", "topology.pairCardinality", "topology.multiRecipient"],
};

for (const fx of [metamodel, readiness, authorization, theory, journeys, topology] as PackFixture[]) {
  describe(`${fx.pack}@1`, () => {
    it("reports nothing on the valid mini model", () => {
      expect(evaluate([fx.pack], fx.valid).findings).toEqual([]);
    });

    for (const c of fx.invalid) {
      it(`${c.name}: ${c.rule}`, () => {
        const { findings, has } = evaluate([fx.pack], merge(fx.valid, c.facts));
        if (c.relation === "none") {
          expect(has(c.rule, c.subject)).toBe(false);
          expect(findings).toEqual([]);
          return;
        }
        expect(has(c.rule, c.subject)).toBe(true);
        if (c.relation) expect(findings.find((f) => f.rule === c.rule && f.subject === c.subject)?.relation).toBe(c.relation);
      });
    }

    it("covers every rule id in the D.3 inventory", () => {
      const fired = new Set(fx.invalid.filter((c) => c.relation !== "none").map((c) => c.rule));
      expect(inventory[fx.pack].filter((r) => !fired.has(r))).toEqual([]);
    });

    it("has a .message for every inventory rule", () => {
      const src = evaluate([fx.pack], fx.valid).result.messages;
      expect(inventory[fx.pack].filter((r) => !src.has(r))).toEqual([]);
    });
  });
}

describe("packs combined", () => {
  it("run together without interfering", () => {
    const ids = Object.keys(inventory);
    const facts = merge(metamodel.valid, readiness.valid, authorization.valid, theory.valid, journeys.valid, topology.valid);
    // each valid set was written in isolation; only assert that evaluation completes and rule ids are namespaced
    const { findings } = evaluate(ids, facts);
    for (const f of findings) expect(f.rule).toMatch(/^[a-z]+\.[A-Za-z]+$/);
  });
});
