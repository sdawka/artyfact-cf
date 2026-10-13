import { describe, expect, it } from "vitest";
import { modalClash, pairScore, sameThing, sharedTerms, termsAcross, termsOf } from "../../src/index.ts";

describe("modalClash", () => {
  it("scores a restrictive against a mandatory modal sharing two content words", () => {
    const s = modalClash("Admins must always approve exports.", "Admins must never approve exports.");
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThanOrEqual(1);
    expect(modalClash("Only managers approve refunds.", "Every refunds request requires managers to sign.")).toBeGreaterThan(0);
  });

  it("is zero without opposite modals or with fewer than two shared words", () => {
    expect(modalClash("Admins must approve exports.", "Admins must approve imports.")).toBe(0);
    expect(modalClash("Admins never approve exports.", "Admins rarely approve exports.")).toBe(0);
    expect(modalClash("Users must sign in.", "Exports are never deleted.")).toBe(0);
    // "must not" is restrictive only, so it does not clash with itself.
    expect(modalClash("Guests must not edit pages.", "Guests must not edit pages.")).toBe(0);
  });
});

describe("sameThing", () => {
  it("matches on title or description Jaccard", () => {
    expect(sameThing({ title: "Export audit log" }, { title: "Export the audit log" })).toBeGreaterThanOrEqual(0.6);
    expect(sameThing({ description: "Every export is written to the audit log." }, { description: "Each export is written to an audit log." })).toBeGreaterThanOrEqual(0.5);
    expect(sameThing({ title: "Export audit log" }, { title: "Import users" })).toBe(0);
    expect(sameThing({}, {})).toBe(0);
  });
});

describe("terms", () => {
  it("collects capitalised and quoted terms, not stop words", () => {
    expect([...termsOf('The Ledger keeps a "settlement window" for Payouts.')].sort()).toEqual(["ledger", "payouts", "settlement window"]);
    expect(sharedTerms("The Ledger is final.", "Payouts read the Ledger.")).toEqual(["ledger"]);
  });

  it("ranks terms used across at least two sections by spread", () => {
    const spread = termsAcross([
      { id: "a", texts: ["The Ledger settles.", "Payouts run daily."] },
      { id: "b", texts: ["Payouts read the Ledger."] },
      { id: "c", texts: ["The Ledger is append-only.", "Refunds wait."] },
    ]);
    expect(spread).toEqual([{ term: "ledger", sections: ["a", "b", "c"] }, { term: "payouts", sections: ["a", "b"] }]);
  });
});

describe("pairScore", () => {
  it("ranks a modal clash above a near-duplicate above unrelated", () => {
    const clash = pairScore({ description: "Admins must always approve exports." }, { description: "Admins must never approve exports." });
    const dup = pairScore({ description: "Exports are logged daily." }, { description: "Exports are logged every day." });
    const none = pairScore({ description: "Users sign in." }, { description: "Exports are logged." });
    expect(clash).toBeGreaterThan(dup);
    expect(dup).toBeGreaterThan(none);
    expect(none).toBe(0);
  });
});
