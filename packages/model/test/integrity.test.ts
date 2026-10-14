import { describe, expect, it } from "vitest";
import { createIntegritySnapshot, agreementEligibility, integrityStatus, type IntegrityProvenance, type IntegrityReport } from "../src/index";
import { ARTYFACT_GENOME } from "@artyfact/ontology";
import { readTree, store } from "./helpers";

const HASH = `sha256:${"a".repeat(64)}`;
const intent = {
  "intent/brief.md": "# Outcome\n\nhello",
  "intent/manifest.json": JSON.stringify({ version: 1, nodes: [{ nodeId: "system.mini", briefSections: ["Outcome"], documents: [{ path: "docs/design.md", hash: HASH }] }] }),
};
const files = () => Object.fromEntries([...readTree(), ...Object.entries(intent)]);

describe("createIntegritySnapshot", () => {
  it("changes exact snapshot identity for brief-only drift", () => {
    const before = createIntegritySnapshot({ systemId: "system.mini", files: files(), templates: store() });
    const after = createIntegritySnapshot({ systemId: "system.mini", files: { ...files(), "intent/brief.md": "hello!" }, templates: store() });

    expect(before.staticFindings).toEqual([]);
    expect(after.genomeHash).toBe(before.genomeHash);
    expect(after.templateClosureHash).toBe(before.templateClosureHash);
    expect(after.intent.briefHash).not.toBe(before.intent.briefHash);
    expect(after.hash).not.toBe(before.hash);
  });

  it("uses only the reachable template closure and ignores unrelated catalog additions", () => {
    const base = createIntegritySnapshot({ systemId: "system.mini", files: files(), templates: store() });
    const withUnrelated = createIntegritySnapshot({
      systemId: "system.mini",
      files: files(),
      templates: {
        get: (ref) => ref === "template.system.unrelated@1"
          ? { id: "template.system.unrelated", version: 1, meta: 1 }
          : store().get(ref),
      },
    });

    expect(base.templateClosure.map((entry) => entry.ref)).toEqual(expect.arrayContaining([ARTYFACT_GENOME]));
    expect(base.templateClosure).toEqual(withUnrelated.templateClosure);
    expect(base.hash).toBe(withUnrelated.hash);
  });

  it("blocks a missing reachable template but permits a source-free Genome", () => {
    const missing = createIntegritySnapshot({ systemId: "system.mini", files: files(), templates: { get: () => undefined } });
    const sourceFree = createIntegritySnapshot({
      systemId: "system.mini",
      files: {
        ...intent,
        "node.yaml": "id: system.mini\nkind: system\ntemplate: template.system.mini@1\nfields: { name: Source-free idea }\n",
        "thing.idea/node.yaml": "id: thing.idea\nkind: thing\ntemplate: template.thing.mini-webapp@1\nfields: { name: Idea, description: Planned only }\n",
      },
      templates: store(),
    });

    expect(missing.staticFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "blocked", code: "template.missing" }),
    ]));
    expect(sourceFree.staticFindings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source.missing" }),
    ]));
  });

  it("blocks a cycle in the reachable template lineage", () => {
    const templates = new Map<string, unknown>([
      ["template.system.a@1", { id: "template.system.a", version: 1, meta: 1, extends: "template.system.b@1" }],
      ["template.system.b@1", { id: "template.system.b", version: 1, meta: 1, extends: "template.system.a@1" }],
    ]);
    const snapshot = createIntegritySnapshot({
      systemId: "system.cycle",
      files: {
        ...intent,
        "node.yaml": "id: system.cycle\nkind: system\ntemplate: template.system.a@1\nfields: { name: Cycle }\n",
      },
      templates: { get: (ref) => templates.get(ref) },
    });

    expect(snapshot.staticFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "blocked", code: "template.cycle" }),
    ]));
  });

  it.each([
    ["system.fabricated", "Outcome", "intent.node"],
    ["system.mini", "Missing heading", "intent.section"],
  ])("blocks fabricated manifest mapping %s / %s", (nodeId, section, code) => {
    const snapshot = createIntegritySnapshot({
      systemId: "system.mini",
      files: {
        ...files(),
        "intent/manifest.json": JSON.stringify({ version: 1, nodes: [{ nodeId, briefSections: [section], documents: [] }] }),
      },
      templates: store(),
    });

    expect(snapshot.intent.fidelity).toBe("invalid");
    expect(snapshot.staticFindings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "blocked", code })]));
  });

  it("maps a realistic nested journey step id containing a slash", () => {
    const snapshot = createIntegritySnapshot({
      systemId: "system.mini",
      files: {
        "node.yaml": "id: system.mini\nkind: system\ntemplate: template.system.mini@1\nfields: { name: Intent example }\n",
        "J.author-intent/node.yaml": "id: J.author-intent\nkind: journey\nfields: { name: Author intent }\n",
        "J.author-intent/check/node.yaml": "id: J.author-intent/check\nkind: step\nfields: { action: Check integrity }\n",
        "intent/brief.md": "# Check\n\nRun integrity for the exact snapshot.\n",
        "intent/manifest.json": JSON.stringify({ version: 1, nodes: [{ nodeId: "J.author-intent/check", briefSections: ["Check"], documents: [] }] }),
      },
      templates: store(),
    });

    expect(snapshot.intent.fidelity).toBe("checked");
    expect(snapshot.staticFindings).toEqual([]);
  });
});

const finding = (id: string, severity: "blocked" | "review" = "review") => ({
  id,
  section: "semantic" as const,
  severity,
  code: id,
  message: id,
  subjects: ["system.mini"],
  evidence: [],
});

const validProvenance: IntegrityProvenance = {
  provider: "openrouter",
  model: "example/model",
  questions: ["semantic.vague"],
  thresholds: { confident: 0.8, review: 0.5 },
  budget: { requestedCalls: 10, maxCalls: 200, usedCalls: 1 },
  truncated: false,
  fake: false,
  retries: 0,
};

const report = (overrides: Partial<IntegrityReport> = {}): IntegrityReport => ({
  version: 1,
  id: "report.1",
  systemId: "system.mini",
  snapshotHash: "snapshot.1",
  policyVersion: "integrity@1",
  createdAt: "2026-10-14T12:00:00.000Z",
  status: "passed",
  structural: { status: "passed", complete: true, findings: [], checkedSubjects: ["system.mini"], checkedRelationships: [], limitations: [] },
  semantic: { status: "passed", complete: true, findings: [], checkedSubjects: ["system.mini"], checkedRelationships: [], limitations: [], intentFidelity: "checked", provenance: validProvenance },
  ...overrides,
});

describe("integrity policy", () => {
  it("blocks structural errors or incomplete deterministic evaluation", () => {
    expect(integrityStatus(report({ structural: { status: "blocked", complete: true, findings: [finding("structure", "blocked")], checkedSubjects: [], checkedRelationships: [], limitations: [] } }))).toBe("blocked");
    expect(integrityStatus(report({ structural: { status: "passed", complete: false, findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [] } }))).toBe("blocked");
    expect(integrityStatus(report({ structural: { status: "unknown", complete: true, findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [] } }))).toBe("blocked");
  });

  it("does not pass a structural section that explicitly needs review", () => {
    expect(integrityStatus(report({ structural: { status: "needs-review", complete: true, findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [] } }))).toBe("needs-review");
  });

  it.each([
    undefined,
    { ...validProvenance, provider: "" },
    { ...validProvenance, model: "" },
    { ...validProvenance, questions: undefined },
    { ...validProvenance, questions: [] },
    { ...validProvenance, thresholds: undefined },
    { ...validProvenance, thresholds: {} },
    { ...validProvenance, thresholds: { review: 0.5 } },
    { ...validProvenance, thresholds: { confident: 0.8 } },
    { ...validProvenance, thresholds: { confident: 1.1, review: 0.5 } },
    { ...validProvenance, thresholds: { confident: 0.4, review: 0.5 } },
    { ...validProvenance, budget: undefined },
    { ...validProvenance, budget: { requestedCalls: 10, maxCalls: 200, usedCalls: 0 } },
    { ...validProvenance, budget: { requestedCalls: 1, maxCalls: 200, usedCalls: 2 } },
    { ...validProvenance, budget: { requestedCalls: 201, maxCalls: 200, usedCalls: 1 } },
    { ...validProvenance, budget: { requestedCalls: 10, maxCalls: 501, usedCalls: 1 } },
    { ...validProvenance, truncated: undefined },
  ])("fails closed when passed semantics omit required provenance %#", (provenance) => {
    const current = report({ semantic: { ...report().semantic, provenance: provenance as IntegrityProvenance | undefined } });

    expect(integrityStatus(current)).toBe("needs-review");
    expect(agreementEligibility(current, [])).toEqual(expect.objectContaining({ eligible: false, status: "pending" }));
  });

  it.each(["not-run", "unknown"] as const)("keeps %s semantics in needs-review", (status) => {
    expect(integrityStatus(report({ semantic: { status, complete: false, findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [], intentFidelity: "missing" } }))).toBe("needs-review");
  });

  it.each(["provider.off", "provider.transport", "budget.exhausted", "coverage.partial"])(
    "keeps limitation %s in needs-review",
    (code) => {
      const limitation = finding(code);
      expect(integrityStatus(report({ semantic: { status: "needs-review", complete: code === "budget.exhausted", findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [limitation], intentFidelity: "checked" } }))).toBe("needs-review");
    },
  );

  it("requires immutable exact-report dispositions with rationale for every review item", () => {
    const item = finding("semantic.vague");
    const current = report({ semantic: { status: "needs-review", complete: true, findings: [item], checkedSubjects: [], checkedRelationships: [], limitations: [], intentFidelity: "checked", provenance: validProvenance } });
    const disposition = { findingId: item.id, decision: "accepted" as const, actor: "user.1", at: "2026-10-14T12:01:00.000Z", reportId: current.id, snapshotHash: current.snapshotHash, rationale: "Intentional broad language." };

    expect(agreementEligibility(current, [])).toEqual(expect.objectContaining({ eligible: false, status: "pending", unresolvedFindingIds: [item.id] }));
    expect(agreementEligibility(current, [{ ...disposition, reportId: "stale" }])).toEqual(expect.objectContaining({ eligible: false, status: "pending" }));
    expect(agreementEligibility(current, [disposition, { ...disposition, findingId: "not-in-report", decision: "rejected" }])).toEqual({ eligible: true, status: "accepted-with-dispositions", unresolvedFindingIds: [] });
    expect(agreementEligibility(current, [disposition])).toEqual({ eligible: true, status: "accepted-with-dispositions", unresolvedFindingIds: [] });
  });

  it("does not make provider-off or no-run reports eligible through a disposition", () => {
    const limitation = finding("provider.off");
    const current = report({ semantic: { status: "needs-review", complete: false, findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [limitation], intentFidelity: "checked" } });
    const disposition = { findingId: limitation.id, decision: "accepted" as const, actor: "user.1", at: "2026-10-14T12:01:00.000Z", reportId: current.id, snapshotHash: current.snapshotHash, rationale: "Accept anyway." };

    expect(agreementEligibility(current, [disposition])).toEqual(expect.objectContaining({ eligible: false, status: "pending" }));
  });

  const provenanceCases: [IntegrityProvenance, string][] = [
    [{ provider: "fake", model: "fixture", questions: [], thresholds: {}, budget: { requestedCalls: 1, maxCalls: 1, usedCalls: 1 }, truncated: false, fake: true, retries: 0 }, "fake"],
    [{ provider: "off", model: "off", questions: [], thresholds: {}, budget: { requestedCalls: 0, maxCalls: 0, usedCalls: 0 }, truncated: false, fake: false, retries: 0 }, "off"],
    [{ provider: "real", model: "model", questions: [], thresholds: {}, budget: { requestedCalls: 1, maxCalls: 1, usedCalls: 1 }, truncated: true, fake: false, retries: 0 }, "truncated"],
  ];
  it.each(provenanceCases)("does not pass %s semantic provenance", (provenance) => {
    const current = report({ semantic: { ...report().semantic, provenance } });

    expect(integrityStatus(current)).toBe("needs-review");
    expect(agreementEligibility(current, [])).toEqual(expect.objectContaining({ eligible: false, status: "pending" }));
  });
});
