import type { Readiness, SystemModel } from "@artyfact/model";
import type { Evaluation, Finding, ReadinessReport, SerializedIndex, SerializedModel } from "../shared/api";

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

const SEVERITY: Record<string, Finding["severity"]> = { error: "error", missing: "error", warning: "warning", info: "info" };

/** Rules-engine readiness (+ evaluations at this revision) → the three never-summed readiness states. */
export function readinessReport(m: SystemModel, r: Readiness, evaluations: Evaluation[], now = new Date()): ReadinessReport {
  const findings: Finding[] = r.findings.map((f) => ({
    ruleId: f.rule,
    severity: SEVERITY[f.level] ?? "info",
    subject: f.subject ?? m.system.id,
    message: f.message,
    facts: { level: f.level, ...(f.pack && { pack: f.pack }) },
  }));
  const latest = new Map<string, Evaluation>();
  for (const e of evaluations) {
    const prev = latest.get(e.criterion);
    if (!prev || prev.at <= e.at) latest.set(e.criterion, e);
  }
  const conf = { pass: 0, fail: 0, unknown: 0, stale: 0, notRun: 0 };
  let observed = 0, unknownOutcome = 0;
  for (const c of m.criteria) {
    if (c.targetKind === "observation" || c.gates.includes("outcome")) {
      if (latest.get(c.id)?.verdict === "pass") observed++;
      else unknownOutcome++;
      continue;
    }
    const e = latest.get(c.id);
    if (!e || e.verdict === "not-run") conf.notRun++;
    else if (e.verdict === "pass" && e.execution === "completed") conf.pass++;
    else if (e.verdict === "pass") conf.unknown++;
    else conf[e.verdict]++;
  }
  return {
    modelReadiness: { findings, blockers: findings.filter((f) => f.severity === "error") },
    implementationConformance: conf,
    outcomeProgress: { observed, unknown: unknownOutcome },
    computedAt: now.toISOString(),
  };
}
