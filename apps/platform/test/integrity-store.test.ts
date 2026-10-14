import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { IntegrityFinding, IntegrityReport, IntegritySnapshot } from "@artyfact/model";
import { IntegrityStore } from "../worker/integrity/store";

const snapshot = (systemId: string): IntegritySnapshot => ({
  version: 1, systemId, hash: `snapshot-${systemId}`, genomeHash: "genome", files: { "node.yaml": `id: ${systemId}\nkind: system\n` },
  intent: { hash: "intent", fidelity: "checked", issues: [], documents: [], brief: "# Intent", manifest: { version: 1, nodes: [] } },
  templateClosure: [], templateClosureHash: "closure", staticFindings: [],
});

const report = (systemId: string, snapshotHash: string, findings: IntegrityFinding[] = []): IntegrityReport => ({
  version: 1, id: `report.${crypto.randomUUID()}`, systemId, snapshotHash, policyVersion: "integrity.v1", createdAt: new Date().toISOString(), status: "passed",
  structural: { status: "passed", complete: true, findings: [], checkedSubjects: [systemId], checkedRelationships: [], limitations: [] },
  semantic: { status: "passed", complete: true, findings, checkedSubjects: [systemId], checkedRelationships: [], limitations: [], intentFidelity: "checked",
    provenance: { provider: "test-real", model: "test-model", questions: ["node.kind"], thresholds: { confident: 0.9, review: 0.5 },
      budget: { requestedCalls: 200, maxCalls: 500, usedCalls: 1 }, truncated: false, fake: false, retries: 0 } },
});

it("reuses active work, fences leases, binds exact immutable agreements, and explicitly truncates oversized reports", async () => {
  const systemId = `system.store${crypto.randomUUID().replaceAll("-", "")}`;
  await runInDurableObject(env.SYSTEMS.getByName(systemId), (_authority, state) => {
    const store = new IntegrityStore(state.storage.sql, systemId);
    const stored = store.putSnapshot(snapshot(systemId), "initial-preview");
    const first = store.start(stored.id, { snapshotId: stored.id, provider: "off", thresholds: { confident: 0.8, review: 0.4 } });
    expect(store.start(stored.id, { snapshotId: stored.id, provider: "off", thresholds: { confident: 0.8, review: 0.4 } })).toMatchObject({ created: false, run: { id: first.run.id } });
    const lease = store.lease()!;
    store.putCheckpoint(first.run.id, "same", { answer: "first" });
    store.putCheckpoint(first.run.id, "same", { answer: "second" });
    expect(store.checkpoint(first.run.id, "same")).toEqual({ answer: "first" });

    const huge = Array.from({ length: 800 }, (_, index): IntegrityFinding => ({
      id: `finding.${index}`, section: "semantic", severity: "info", code: "test.large", message: "x".repeat(1000), subjects: [systemId], evidence: ["y".repeat(1000)],
    }));
    const completed = store.complete(first.run.id, lease.token, report(systemId, stored.hash, huge));
    expect(completed.report?.semantic.limitations).toEqual(expect.arrayContaining([expect.objectContaining({ code: "report.truncated" })]));
    expect(completed.report?.semantic.provenance?.truncated).toBe(true);
    expect(completed.report?.status).toBe("needs-review");
    expect(() => store.complete(first.run.id, lease.token, report(systemId, stored.hash))).toThrow(/stale integrity run lease/);
    const same = { snapshotId: stored.id, provider: "off" as const, thresholds: { confident: 0.8, review: 0.4 } };
    expect(store.start(stored.id, same)).toMatchObject({ created: false, run: { id: first.run.id, attempt: 1 } });
    const rerun = store.start(stored.id, { ...same, rerun: true });
    expect(rerun).toMatchObject({ created: true, run: { attempt: 2 } });
    store.cancel(rerun.run.id);

    const second = store.start(stored.id, { snapshotId: stored.id, provider: "auto" }).run;
    const secondLease = store.lease()!;
    store.complete(second.id, secondLease.token, report(systemId, stored.hash));
    expect(store.agree(second.id, { dispositions: [] }).agreement?.status).toBe("accepted");
    expect(store.binding(second.id, stored.hash)).toMatchObject({ runId: second.id, snapshotHash: stored.hash, agreementStatus: "accepted" });
    expect(() => store.binding(second.id, "another-snapshot")).toThrow(/does not match/);
    expect(() => store.agree(second.id, { dispositions: [{ findingId: "new", decision: "accepted", rationale: "changed" }] })).toThrow(/immutable/);
  });
});
