import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { createIntegritySnapshot, type IntegrityFinding, type IntegrityReport, type IntegritySnapshot } from "@artyfact/model";
import { IntegrityStore } from "../worker/integrity/store";
import { acceptedTemplateResolver, OntologyPackagesStore } from "../worker/ontology-packages/store";

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
    const selected = { provider: "off" as const, model: "off" };
    const first = store.start(stored.id, { snapshotId: stored.id, provider: "off", thresholds: { confident: 0.8, review: 0.4 } }, selected);
    expect(store.start(stored.id, { snapshotId: stored.id, provider: "off", thresholds: { confident: 0.8, review: 0.4 } }, selected)).toMatchObject({ created: false, run: { id: first.run.id } });
    const lease = store.lease()!;
    expect(store.nextAlarm(0)).toBe(lease.expiresAt);
    store.assertProviderIdentity(first.run.id, lease.token, { provider: "typesafe", model: "jev-v1" });
    store.assertProviderIdentity(first.run.id, lease.token, { provider: "typesafe", model: "jev-v1" });
    expect(() => store.assertProviderIdentity(first.run.id, lease.token, { provider: "openrouter", model: "jev-v2" })).toThrow(/provider identity changed/);
    store.putCheckpoint(first.run.id, "same", { answer: "first" });
    store.putCheckpoint(first.run.id, "same", { answer: "second" });
    expect(store.checkpoint(first.run.id, "same")).toEqual({ answer: "first" });

    const huge = Array.from({ length: 800 }, (_, index): IntegrityFinding => ({
      id: `finding.${index}`, section: "semantic", severity: index === 799 ? "blocked" : "info", code: "test.large", message: "x".repeat(1000), subjects: [systemId], evidence: ["y".repeat(1000)],
    }));
    const completed = store.complete(first.run.id, lease.token, report(systemId, stored.hash, huge));
    expect(completed.report?.semantic.limitations).toEqual(expect.arrayContaining([expect.objectContaining({ code: "report.truncated" })]));
    expect(completed.report?.semantic.provenance?.truncated).toBe(true);
    expect(completed.report?.semantic.status).toBe("blocked");
    expect(completed.report?.status).toBe("blocked");
    expect(() => store.complete(first.run.id, lease.token, report(systemId, stored.hash))).toThrow(/stale integrity run lease/);
    const same = { snapshotId: stored.id, provider: "off" as const, thresholds: { confident: 0.8, review: 0.4 } };
    expect(store.start(stored.id, same, selected)).toMatchObject({ created: false, run: { id: first.run.id, attempt: 1 } });
    const rerun = store.start(stored.id, { ...same, rerun: true }, selected);
    expect(rerun).toMatchObject({ created: true, run: { attempt: 2 } });
    store.cancel(rerun.run.id);

    const second = store.start(stored.id, { snapshotId: stored.id, provider: "auto" }, { provider: "typesafe", model: "jev-latest" }).run;
    const secondLease = store.lease()!;
    store.complete(second.id, secondLease.token, report(systemId, stored.hash));
    expect(store.agree(second.id, { dispositions: [] }).agreement?.status).toBe("accepted");
    expect(store.binding(second.id, stored.hash)).toMatchObject({ runId: second.id, snapshotHash: stored.hash, agreementStatus: "accepted" });
    expect(() => store.binding(second.id, "another-snapshot")).toThrow(/does not match/);
    expect(() => store.agree(second.id, { dispositions: [{ findingId: "new", decision: "accepted", rationale: "changed" }] })).toThrow(/immutable/);
  });
});

it("reclaims an expired stranded lease from its durably scheduled alarm", async () => {
  const systemId = `system.stranded${crypto.randomUUID().replaceAll("-", "")}`;
  const runId = await runInDurableObject(env.SYSTEMS.getByName(systemId), async (authority, state) => {
    await authority.ontologyInitialize(systemId);
    const store = new IntegrityStore(state.storage.sql, systemId);
    const templates = acceptedTemplateResolver(new OntologyPackagesStore(state.storage.sql).acceptedPackages()).templates;
    const stored = store.putSnapshot(createIntegritySnapshot({ systemId, files: snapshot(systemId).files, templates }), "initial-preview");
    const started = store.start(stored.id, { snapshotId: stored.id, provider: "off" }, { provider: "off", model: "off" }).run;
    const stranded = store.lease(Date.now() - 6 * 60_000)!;
    await state.storage.setAlarm(stranded.expiresAt);
    return started.id;
  });
  await runDurableObjectAlarm(env.SYSTEMS.getByName(systemId));
  const completed = await env.SYSTEMS.getByName(systemId).integrityRun(runId);
  expect(completed?.state, completed?.error?.message).toBe("completed");
});

it("keeps the first observed provider identity across a reclaimed lease", async () => {
  const systemId = `system.providerlease${crypto.randomUUID().replaceAll("-", "")}`;
  await runInDurableObject(env.SYSTEMS.getByName(systemId), (_authority, state) => {
    const store = new IntegrityStore(state.storage.sql, systemId);
    const stored = store.putSnapshot(snapshot(systemId), "initial-preview");
    const started = store.start(stored.id, { snapshotId: stored.id, provider: "jev" }, { provider: "typesafe", model: "jev-latest" }).run;
    const first = store.lease(1_000)!;
    store.assertProviderIdentity(started.id, first.token, { provider: "typesafe", model: "jev-2026-10" });
    const reclaimed = store.lease(first.expiresAt)!;
    expect(() => store.assertProviderIdentity(started.id, reclaimed.token, {
      provider: "openrouter", model: "typesafe/jev-2",
    })).toThrow(/provider identity changed/);
  });
});

it("fails a queued run when its preview template closure is no longer current", async () => {
  const systemId = `system.templatedrift${crypto.randomUUID().replaceAll("-", "")}`;
  const runId = await runInDurableObject(env.SYSTEMS.getByName(systemId), async (authority, state) => {
    await authority.ontologyInitialize(systemId);
    const files = { "node.yaml": `id: ${systemId}\nkind: system\ntemplate: template.system.once@1\nfields: { name: Once }\n` };
    const preview = createIntegritySnapshot({
      systemId, files, templates: { get: () => ({ id: "template.system.once", version: 1, meta: 1 }) },
    });
    const store = new IntegrityStore(state.storage.sql, systemId);
    const stored = store.putSnapshot(preview, "initial-preview");
    const runId = store.start(stored.id, { snapshotId: stored.id, provider: "off" }, { provider: "off", model: "off" }).run.id;
    // The helper fires this alarm; leave time so the real scheduler cannot claim it first.
    await state.storage.setAlarm(Date.now() + 60_000);
    return runId;
  });
  await runDurableObjectAlarm(env.SYSTEMS.getByName(systemId));
  expect(await env.SYSTEMS.getByName(systemId).integrityRun(runId)).toMatchObject({
    state: "failed", error: { code: "template-drift" },
  });
});
