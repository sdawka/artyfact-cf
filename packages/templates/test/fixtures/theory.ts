import { merge } from "../engine";
import type { Facts } from "../engine";
import type { PackFixture } from "./types";

export const valid = {
  ext: [["ext.owner", "person"], ["ext.contacts", "group"], ["ext.svc", "service"]],
  purpose: [["P1"]],
  purposeBeneficiary: [["P1", "ext.owner"]],
  claim: [["T1"], ["T5"]],
  claimDeferred: [["T5"]],
  claimIndicator: [["T1"]],
  claimMethod: [["T1"]],
  claimBeneficiary: [["T1", "ext.owner"]],
  criterionSourceRef: [["C.1", "T1"]],
};

/** A non-deferred claim with only the listed parts present. */
function claim(id: string, parts: { indicator?: boolean; method?: boolean; beneficiary?: boolean; linked?: boolean }): Facts {
  return merge(
    { claim: [[id]] },
    parts.indicator ? { claimIndicator: [[id]] } : {},
    parts.method ? { claimMethod: [[id]] } : {},
    parts.beneficiary ? { claimBeneficiary: [[id, "ext.owner"]] } : {},
    parts.linked ? { criterionSourceRef: [["C.1", id]] } : {},
  );
}
const all = { indicator: true, method: true, beneficiary: true, linked: true };

export const theory: PackFixture = {
  pack: "theory",
  valid,
  invalid: [
    { name: "purpose without beneficiaries", rule: "purpose.beneficiary", subject: "P2", facts: { purpose: [["P2"]] } },
    { name: "service as beneficiary", rule: "purpose.beneficiaryKind", subject: "P1", facts: { purposeBeneficiary: [["P1", "ext.svc"]] } },
    { name: "non-external beneficiary", rule: "purpose.beneficiaryKind", subject: "P1", facts: { purposeBeneficiary: [["P1", "thing.a"]] } },
    { name: "claim without indicator", rule: "theory.indicator", subject: "T2", facts: claim("T2", { ...all, indicator: false }) },
    { name: "claim without method", rule: "theory.method", subject: "T3", facts: claim("T3", { ...all, method: false }) },
    { name: "claim without beneficiary", rule: "theory.beneficiary", subject: "T4", facts: claim("T4", { ...all, beneficiary: false }) },
    { name: "claim nothing refers to", rule: "theory.outcomeUnlinked", subject: "T6", facts: claim("T6", { ...all, linked: false }) },
  ],
};
