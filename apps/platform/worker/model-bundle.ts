import type { Readiness, SystemModel } from "@artyfact/model";
import type { Evaluation, ReadinessReport, SerializedIndex, SerializedModel } from "../shared/api";
import { foldVerdict, offTriggerHookIds } from "../shared/verdict";

/** SystemModel → JSON-safe form: index functions materialised, `byId` without duplicated items. */
export function serializeModel(m: SystemModel): SerializedModel {
  const { index, ...rest } = m;
  const byId: SerializedIndex["byId"] = {};
  const paths: SerializedIndex["paths"] = {};
  const layers: SerializedIndex["layers"] = {};
  for (const [id, e] of Object.entries(index.byId)) {
    byId[id] = { id: e.id, type: e.type, kind: e.kind, name: e.name };
    paths[id] = index.path(id);
    const l = index.layer(id);
    if (l) layers[id] = l;
  }
  const { path: _p, layer: _l, byId: _b, ...plain } = index;
  return JSON.parse(JSON.stringify({ ...rest, index: { ...plain, byId, paths, layers } })) as SerializedModel;
}

const BLOCKING = new Set(["error", "missing"]);

/**
 * Rules-engine readiness (+ evaluations at this revision) → the three never-summed readiness states. Each criterion's
 * rows are folded across hooks like the promotion gate (shared/verdict.ts): one failing hook makes it fail.
 */
export function readinessReport(m: Pick<SystemModel, "criteria"> & { hooks?: SystemModel["hooks"] }, r: Readiness, evaluations: Evaluation[], now = new Date()): ReadinessReport {
  const findings = r.findings;
  const byCriterion = new Map<string, Evaluation[]>();
  for (const e of evaluations) byCriterion.set(e.criterion, [...(byCriterion.get(e.criterion) ?? []), e]);
  const offTrigger = offTriggerHookIds(m.hooks);
  const conf = { pass: 0, fail: 0, unknown: 0, stale: 0, notRun: 0 };
  let observed = 0, unknownOutcome = 0;
  for (const c of m.criteria) {
    const v = foldVerdict(byCriterion.get(c.id) ?? [], offTrigger);
    if (c.targetKind === "observation" || c.gates.includes("outcome")) {
      if (v === "pass") observed++;
      else unknownOutcome++;
      continue;
    }
    if (v === "not-run") conf.notRun++;
    else if (v === "pass") conf.pass++;
    else if (v === "fail") conf.fail++;
    else if (v === "stale") conf.stale++;
    else conf.unknown++; // unknown, waived, or pass without a completed run
  }
  return {
    ...r,
    modelReadiness: { findings, blockers: findings.filter((f) => BLOCKING.has(f.level)) },
    implementationConformance: conf,
    outcomeProgress: { observed, unknown: unknownOutcome },
    computedAt: now.toISOString(),
  };
}
