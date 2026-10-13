import { describe, expect, it } from "vitest";
import { DEFECTS, DEFECTS_VERSION, defectChildren, defectIndex, defectPath, loadTemplate, mergeDefects, OTHER_KIND, otherKindDefects, templateFacts } from "../../src/index.ts";

const idx = defectIndex();
const roots = DEFECTS.filter((d) => d.parent === undefined);
const nonLeaves = DEFECTS.filter((d) => defectChildren(d.id).length > 0);

describe("defects@1", () => {
  it("is versioned and has the five families", () => {
    expect(DEFECTS_VERSION).toBe("1");
    expect(roots.map((d) => d.id)).toEqual(["instance", "specificity", "testability", "consistency", "coherence"]);
  });

  it("has unique ids built from the parent id and the label", () => {
    expect(idx.size).toBe(DEFECTS.length);
    for (const d of DEFECTS) {
      expect(d.id).toBe(d.parent ? `${d.parent}.${d.label}` : d.label);
      expect(d.id.split(".").at(-1)).toBe(d.label);
    }
  });

  it("names only existing parents, declared before their children, and is acyclic", () => {
    const seen = new Set<string>();
    for (const d of DEFECTS) {
      if (d.parent !== undefined) {
        expect(idx.has(d.parent)).toBe(true);
        expect(seen.has(d.parent)).toBe(true);
      }
      seen.add(d.id);
      const path = defectPath(d.id);
      expect(path.at(-1)?.id).toBe(d.id);
      expect(path[0]?.parent).toBeUndefined();
      expect(new Set(path.map((p) => p.id)).size).toBe(path.length);
    }
  });

  it("is at most three levels deep with 4-5 categories per level", () => {
    for (const d of DEFECTS) expect(defectPath(d.id).length).toBeLessThanOrEqual(3);
    for (const r of roots) expect(defectChildren(r.id)).toHaveLength(5);
    // otherKind's leaves are generated per vocabulary.
    for (const d of nonLeaves) {
      const n = defectChildren(d.id).length;
      expect(n === 4 || n === 5, `${d.id} has ${n} children`).toBe(true);
    }
    expect(defectChildren(OTHER_KIND)).toEqual([]);
    expect(DEFECTS.filter((d) => defectPath(d.id).length === 2)).toHaveLength(25);
  });

  it("carries a short label and a criterion a decision model can use as an option", () => {
    for (const d of DEFECTS) {
      expect(d.criterion.length, d.id).toBeGreaterThan(20);
      expect(d.criterion.length, d.id).toBeLessThanOrEqual(255);
      expect(d.label).toMatch(/^[a-z][A-Za-z]*$/);
    }
  });

  it("defaults to warning, with the listed errors and the deterministic placeholder", () => {
    expect(DEFECTS.filter((d) => d.level === "error").map((d) => d.id)).toEqual([
      "consistency.contradiction", "consistency.contradiction.modal", "consistency.contradiction.quantity",
      "consistency.contradiction.state", "consistency.contradiction.actor", "consistency.contradiction.timing",
      "consistency.scopeClash", "consistency.scopeClash.permissionNarrower", "consistency.scopeClash.ownerVsShared",
      "consistency.scopeClash.roleMismatch", "consistency.scopeClash.conditional", "coherence.summaryMismatch.contradicts",
    ]);
    expect(DEFECTS.filter((d) => d.level !== "error").every((d) => d.level === "warning")).toBe(true);
    expect(DEFECTS.filter((d) => d.deterministic).map((d) => [d.id, d.deterministic])).toEqual([["instance.placeholder", "text.placeholder"]]);
  });

  it("generates otherKind leaves per kind", () => {
    expect(otherKindDefects({ outcome: "an outcome" })).toMatchObject([{ id: "instance.otherKind.outcome", parent: OTHER_KIND, scope: "node", label: "outcome" }]);
  });
});

describe("mergeDefects", () => {
  it("disables a subtree and overrides levels", () => {
    const { defects, unknown } = mergeDefects(DEFECTS, { disable: ["coherence.termDrift"], levels: { "specificity.abstract": "error" } });
    expect(unknown).toEqual([]);
    expect(defects.some((d) => d.id.startsWith("coherence.termDrift"))).toBe(false);
    expect(defects).toHaveLength(DEFECTS.length - 5);
    expect(defects.find((d) => d.id === "specificity.abstract")?.level).toBe("error");
    expect(defects.find((d) => d.id === "specificity.abstract.jargon")?.level).toBe("warning");
    expect(DEFECTS.find((d) => d.id === "specificity.abstract")?.level).toBe("warning");
  });

  it("reports unknown ids instead of throwing", () => {
    const { defects, unknown } = mergeDefects(DEFECTS, { disable: ["nope", "coherence"], levels: { "also.nope": "info" } });
    expect(unknown).toEqual(["also.nope", "nope"]);
    expect(defects.some((d) => d.id.startsWith("coherence"))).toBe(false);
  });

  it("is the identity without overrides", () => {
    expect(mergeDefects(DEFECTS)).toEqual({ defects: [...DEFECTS], unknown: [] });
  });
});

describe("defect facts", () => {
  const tpl = (extra: object = {}) => loadTemplate({ id: "template.test.defects", version: 1, meta: 1, kinds: { doc: {} }, ...extra });

  it("emits the merged taxonomy, question defects and follow-ups", () => {
    const f = templateFacts(tpl({
      defects: { disable: ["coherence"], levels: { "instance.compound": "info" } },
      questions: [
        { id: "a", answer: "yes-no", benign: "no", defect: "specificity", policy: [{ answer: "yes", level: "warning", defect: "specificity.abstract" }], next: [{ answer: "yes", ask: "b" }, { answer: "yes", ask: "b", over: "members" }] },
        { id: "b", answer: "yes-no", benign: "no", policy: [{ answer: "yes", level: "warning" }] },
      ],
    }));
    expect(f.defect).toContainEqual(["instance", "", "node", "warning"]);
    expect(f.defect).toContainEqual(["instance.compound", "instance", "node", "info"]);
    expect(f.defect!.some((t) => String(t[0]).startsWith("coherence"))).toBe(false);
    expect(f.questionDefect).toEqual([["a", "specificity"], ["a", "specificity.abstract"]]);
    expect(f.questionNext).toEqual([["a", "b"]]);
  });

  it("leaves a template without a defects block hashed as before", () => {
    expect("defects" in tpl()).toBe(false);
    expect("defects" in tpl({ defects: { disable: [], levels: {} } })).toBe(false);
    expect(tpl({ defects: {} }).hash).toBe(tpl().hash);
  });
});
