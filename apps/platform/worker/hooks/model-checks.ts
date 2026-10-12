/**
 * model-rules hook extras (C.system.promotion, C.system.autonomy on the Keep in Touch Genome):
 * - `inputs.packs` / `inputs.rulePrefix`: the rules part (model-rules.ts).
 * - `inputs.requires`: comma list of criteria that must exist, non-deferred, in the judged model.
 * - `inputs.check`: scope-authorized (diff-scope.ts), base-current, manifest-exact, evidence-fresh (the last three
 *   from `ctx.promotionFacts`; not-run when absent).
 * Parts fold: any fail → fail; all pass (completed) → pass; else unknown.
 */
import type { SystemModel, schema } from "@artyfact/model";
import type { SubmissionContext } from "./contract";
import { diffScope } from "./diff-scope";
import type { ModelRulesResult } from "./model-rules";
import { errored as erroredOutcome, notRun, type Outcome } from "./provenance";

export interface ModelCheckEnv {
  ctx: SubmissionContext;
  base: SystemModel;
  /** model-rules result for the candidate (Genome target) or the canonical Genome (app target), filtered by `h`. */
  rules(h: schema.AssayHook | null): ModelRulesResult;
}

/** Criteria named in `inputs.requires` must exist in the judged model and not be deferred. */
function requiresCheck(env: ModelCheckEnv, h: schema.AssayHook): { missing: string[] } | null {
  const ids = (h.inputs.requires ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!ids.length) return null;
  const m = env.ctx.candidate.target === "genome" ? env.rules(null).model ?? env.base : env.base;
  const present = new Set(m.criteria.filter((c) => !c.deferred).map((c) => c.id));
  return { missing: ids.filter((id) => !present.has(id)) };
}

/**
 * `inputs.check` items (C.system.promotion). Each yields a part; promotion-only facts come from
 * `ctx.promotionFacts` and are `not-run` when absent.
 */
export function promotionCheck(env: ModelCheckEnv, check: string): Outcome {
  const c = env.ctx.candidate;
  const facts = env.ctx.promotionFacts;
  const fact = (v: boolean | undefined, okText: string, failText: string): Outcome =>
    v === undefined
      ? notRun(`${check} is established by the DO at promotion (ctx.promotionFacts not supplied).`)
      : { execution: "completed", verdict: v ? "pass" : "fail", observations: [], interpretation: v ? okText : failText, limitations: [] };
  switch (check) {
    case "scope-authorized":
      return diffScope({ target: c.target, changedPaths: c.changedPaths, changedNodes: c.changedNodes, pathNodes: c.pathNodes, permitted: env.ctx.permittedPaths, protected: env.ctx.protectedPaths });
    case "base-current":
      return facts?.currentBaseCommit === undefined
        ? notRun("base-current needs the current head (ctx.promotionFacts.currentBaseCommit).")
        : fact(facts.currentBaseCommit === c.baseCommit, "Candidate base is the current head.", `Stale base: candidate is based on ${c.baseCommit.slice(0, 12)}, head is ${facts.currentBaseCommit.slice(0, 12)}.`);
    case "manifest-exact":
      return fact(facts?.manifestExact, "Manifest binds exactly this candidate.", "Manifest does not match the candidate.");
    case "evidence-fresh":
      return fact(facts?.evidenceFresh, "Required evidence is fresh for this commit.", "Required evidence is stale or belongs to another candidate.");
    default:
      return erroredOutcome(new Error(`Unknown check "${check}"`), { interpretation: `Unknown check "${check}"` });
  }
}

export function modelRulesHook(env: ModelCheckEnv, h: schema.AssayHook): Outcome {
  const checks = (h.inputs.check ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const parts: { check: string; o: Outcome }[] = [];
  if (!checks.length || h.inputs.packs || h.inputs.rulePrefix) parts.push({ check: "rules", o: env.rules(h).outcome });
  for (const check of checks) {
    let o: Outcome;
    try {
      o = promotionCheck(env, check);
    } catch (e) {
      o = erroredOutcome(e);
    }
    parts.push({ check, o });
  }
  const req = requiresCheck(env, h);
  if (req) {
    parts.push({
      check: "requires",
      o: {
        execution: "completed",
        verdict: req.missing.length ? "fail" : "pass",
        observations: [{ kind: "requires", missing: req.missing }],
        interpretation: req.missing.length ? `Required criteria missing or deferred: ${req.missing.join(", ")}.` : "All required criteria are present.",
        limitations: [],
      },
    });
  }
  if (parts.length === 1) return parts[0].o;
  const failed = parts.filter((p) => p.o.verdict === "fail");
  const allPass = parts.every((p) => p.o.verdict === "pass" && p.o.execution === "completed");
  const ran = parts.some((p) => p.o.execution === "completed");
  const errored = parts.filter((p) => p.o.execution === "error");
  return {
    // Any errored part with nothing completed is an error; mixed parts stay completed but name the errored ones.
    execution: ran ? "completed" : errored.length ? "error" : "not-run",
    verdict: failed.length ? "fail" : allPass ? "pass" : "unknown",
    observations: parts.flatMap((p) =>
      p.check === "rules" || p.check === "requires"
        ? p.o.observations
        : [{ check: p.check, execution: p.o.execution, verdict: p.o.verdict, interpretation: p.o.interpretation, observations: p.o.observations, limitations: p.o.limitations }]),
    interpretation: parts.map((p) => `${p.check}: ${p.o.verdict}${p.o.verdict === "pass" ? "" : ` (${p.o.interpretation ?? p.o.limitations.join("; ")})`}`).join("; "),
    limitations: [
      ...parts.flatMap((p) => (p.check === "rules" || p.check === "requires" ? p.o.limitations : [])),
      ...(ran && errored.length ? [`Part(s) ${errored.map((p) => p.check).join(", ")} errored; see observations.`] : []),
    ],
    provenance: parts.find((p) => p.check === "rules")?.o.provenance,
  };
}
