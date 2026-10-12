/**
 * HookRunner implementation: selects a candidate's hooks from the canonical Genome and dispatches by `hook.engine`.
 *
 * Hook selection (base Genome at `ctx.genomeCommit`):
 *   affected criteria = acceptance criteria of the candidate's Evolution        (reason "acceptance")
 *                     ∪ criteria whose subjectId is in candidate.changedNodes    (reason "subject")
 *                     ∪ System-owned criteria with `submission` in gates         (reason "system-gate")
 *   in that order, deduped, deferred criteria dropped. Every hook bound to an affected criterion (hook.criteria ∪
 *   criterion.hooks) yields one Evaluation per (hook, criterion); a criterion with no hook yields hook "none".
 *   A hook runs when its engine is a platform engine (manifest, diff, model-rules, llm, http) and its triggers
 *   include `submission` or `candidate`; `http` also runs off-trigger because a submitted previewUrl is the only
 *   runtime the platform sees. Everything else is `not-run / unknown` with the reason in `limitations`, so the
 *   promotion panel shows it grey instead of missing.
 *
 * Engines: manifest → manifest-exists.ts; diff (inputs.mode scope|overlap, else inferred from id/assay) →
 * diff-scope.ts / overlap.ts; model-rules → model-rules.ts (inputs.packs filter, inputs.requires criteria,
 * inputs.check list, see `promotionChecks`); system-one / llm (inputs.judgment reviewDelta|topology|
 * purposeMeasures|interference) → system-one.ts; http → http-health.ts. Any throw → `execution: error`.
 */
import { type Readiness, type SystemModel, type schema } from "@artyfact/model";
import { createSystemOne, type SystemOne, type SystemOneEnv } from "@artyfact/semantic";
import type { CandidateRef, ConflictContext, ConflictReport, DeltaReview, Evaluation, GenomeContext, GenomeResult, HookRunner, SubmissionContext } from "./contract";
import { diffScope } from "./diff-scope";
import { HEALTH_TIMEOUT_MS, httpHealth } from "./http-health";
import { manifestExists } from "./manifest-exists";
import { filterFromInputs, loadGenome, modelRules, type GenomeDeps, type ModelRulesResult } from "./model-rules";
import { computeConflicts } from "./overlap";
import { errored, errorMessage, notRun, toEvaluation, type Outcome } from "./provenance";
import { aggregate, judgePurpose, reviewGenome, reviewsAsJudged } from "./system-one";

export interface RunnerDeps {
  /** System One client; defaults to `createSystemOne(s1Env ?? {})` (provider off when no key). */
  s1?: SystemOne;
  s1Env?: SystemOneEnv;
  fetch?: typeof fetch;
  now?: () => Date;
  genome?: GenomeDeps;
}

export type SelectionReason = "acceptance" | "subject" | "system-gate";

export interface Selected {
  criterion: schema.Criterion;
  /** null: the criterion has no hook. */
  hook: schema.AssayHook | null;
  reason: SelectionReason;
  run: boolean;
  /** Why it will not run (when `run` is false). */
  skip?: string;
  /** Problems with the selection itself (e.g. Evolution missing from the Genome). */
  notes: string[];
}

const PLATFORM_ENGINES = new Set<schema.AssayHook["engine"]>(["manifest", "diff", "model-rules", "system-one", "llm", "http"]);
const SUBMISSION_TRIGGERS = new Set<schema.Gate>(["submission", "candidate"]);

/** A stand-in for an acceptance criterion id the Genome does not define, so the gap still shows. */
function phantomCriterion(id: string, m: SystemModel): schema.Criterion {
  return {
    id, version: 1, title: id, claim: "(criterion not found in the Genome)", ownerKind: "system", ownerId: m.system.id,
    subjectKind: "system", subjectId: m.system.id, targetKind: "model", sourceRefs: [], refines: [], satisfies: [],
    severity: "hard", gates: [], deferred: false, hooks: [],
  };
}

export function selectHooks(m: SystemModel, candidate: CandidateRef): Selected[] {
  const criteria = new Map(m.criteria.map((c) => [c.id, c] as const));
  const hooks = new Map(m.hooks.map((h) => [h.id, h] as const));
  const evolution = m.evolutions.find((e) => e.id === candidate.evolutionId);
  const notes = evolution ? [] : [`Evolution ${candidate.evolutionId} is not in the Genome at base; its acceptance criteria are unknown.`];
  const changed = new Set(candidate.changedNodes);

  const picked: { c: schema.Criterion; reason: SelectionReason; phantom?: boolean }[] = [];
  const seen = new Set<string>();
  const add = (c: schema.Criterion, reason: SelectionReason, phantom = false) => {
    if (seen.has(c.id) || c.deferred) return;
    seen.add(c.id);
    picked.push({ c, reason, phantom });
  };
  for (const id of evolution?.acceptanceCriteria ?? []) {
    const c = criteria.get(id);
    add(c ?? phantomCriterion(id, m), "acceptance", !c);
  }
  for (const c of m.criteria) if (changed.has(c.subjectId)) add(c, "subject");
  for (const c of m.criteria) if (c.ownerKind === "system" && c.gates.includes("submission")) add(c, "system-gate");

  const out: Selected[] = [];
  for (const { c, reason, phantom } of picked) {
    if (phantom) {
      out.push({ criterion: c, hook: null, reason, run: false, skip: `Acceptance criterion ${c.id} is not defined in the Genome.`, notes });
      continue;
    }
    const hookIds = [...new Set([...(m.index.hooksByCriterion[c.id] ?? []), ...c.hooks])];
    const bound = hookIds.map((id) => hooks.get(id)).filter((h): h is schema.AssayHook => h !== undefined);
    const dangling = hookIds.filter((id) => !hooks.has(id));
    const cNotes = dangling.length ? [...notes, `Hook(s) ${dangling.join(", ")} referenced but not defined.`] : notes;
    if (bound.length === 0) {
      out.push({ criterion: c, hook: null, reason, run: false, skip: "No hook is bound to this criterion.", notes: cNotes });
      continue;
    }
    for (const h of bound) {
      let skip: string | undefined;
      if (!PLATFORM_ENGINES.has(h.engine)) skip = `Engine ${h.engine} runs in the agent's or CI environment, not in the platform.`;
      else if (h.engine !== "http" && !h.triggers.some((t) => SUBMISSION_TRIGGERS.has(t))) skip = `Triggers [${h.triggers.join(", ")}] do not include submission or candidate.`;
      out.push({ criterion: c, hook: h, reason, run: !skip, ...(skip && { skip }), notes: cNotes });
    }
  }
  return out;
}

const NO_HOOK = { id: "none", engine: "none" } as const;

/** Lazily computed, per-call shared state so a hook bound to several criteria runs once. */
interface RunState {
  ctx: SubmissionContext;
  base: SystemModel;
  rules?: ModelRulesResult;
  reviews?: DeltaReview[];
  conflicts?: Promise<ConflictReport[]>;
}

function diffMode(h: schema.AssayHook): "scope" | "overlap" {
  const mode = h.inputs.mode?.trim();
  if (mode === "overlap" || mode === "scope") return mode;
  return /overlap/i.test(`${h.id} ${h.assay}`) ? "overlap" : "scope";
}

function llmJudgment(h: schema.AssayHook, c: schema.Criterion): string {
  const j = h.inputs.judgment?.trim();
  if (j) return j;
  if (/purpose/i.test(c.id)) return "purposeMeasures";
  if (/topology/i.test(c.id)) return "topology";
  return "reviewDelta";
}

export function createHookRunner(deps: RunnerDeps = {}): HookRunner {
  const s1 = deps.s1 ?? createSystemOne(deps.s1Env ?? {});
  const now = () => (deps.now ?? (() => new Date()))().toISOString();

  const loadBase = (ctx: ConflictContext): SystemModel => {
    try {
      return loadGenome(ctx.genomeFiles, ctx.genomeCommit, deps.genome);
    } catch (e) {
      // Without the canonical Genome no criterion can be resolved: fail the call loudly.
      throw new Error(`Canonical Genome at ${ctx.genomeCommit} does not load: ${errorMessage(e)}`);
    }
  };

  const rulesFor = (st: RunState, h: schema.AssayHook | null): ModelRulesResult => {
    const filter = h ? filterFromInputs(h.inputs) : undefined;
    const c = st.ctx.candidate;
    if (c.target === "genome") {
      if (!c.genomeFiles) throw new Error(`Genome candidate ${c.id} has no genomeFiles`);
      if (!filter && st.rules) return st.rules;
      const r = modelRules({ files: c.genomeFiles, revision: c.commit, base: st.base, filter, deps: deps.genome });
      if (!filter) st.rules = r;
      return r;
    }
    if (!filter && st.rules) return st.rules;
    const r = modelRules({ files: st.ctx.genomeFiles, revision: st.ctx.genomeCommit, filter, deps: deps.genome });
    r.outcome.limitations.push("App candidate: the Genome is unchanged, so rules ran on the canonical Genome at base.");
    if (!filter) st.rules = r;
    return r;
  };

  const conflictsFor = (st: RunState) => (st.conflicts ??= computeConflicts(st.ctx, st.base, { s1, genome: deps.genome }));

  async function reviewsFor(st: RunState): Promise<DeltaReview[]> {
    if (st.reviews) return st.reviews;
    const r = rulesFor(st, null);
    st.reviews = r.model && r.delta && r.readiness ? await reviewGenome(s1, st.base, r.model, r.delta, r.readiness.derived) : [];
    return st.reviews;
  }

  async function engine(st: RunState, h: schema.AssayHook, c: schema.Criterion): Promise<Outcome> {
    const cand = st.ctx.candidate;
    switch (h.engine) {
      case "manifest":
        return manifestExists(st.ctx.tree, h.inputs);
      case "diff": {
        if (diffMode(h) === "scope") {
          return diffScope({ target: cand.target, changedPaths: cand.changedPaths, changedNodes: cand.changedNodes, permitted: st.ctx.permittedPaths, protected: st.ctx.protectedPaths });
        }
        const reports = await conflictsFor(st);
        const hard = reports.filter((r) => r.kind === "hard-semantic");
        return {
          execution: "completed",
          // Reporting overlap is the obligation; only a hard-semantic conflict fails it. Soft/file conflicts are
          // listed for the reviewer and resolved by promotion CAS (the loser goes stale).
          verdict: hard.length ? "fail" : "pass",
          observations: reports,
          interpretation: reports.length
            ? `${reports.length} conflict(s) with open candidates: ${reports.map((r) => `${r.kind} with ${r.candidates[1]}`).join("; ")}.`
            : `No overlap with ${st.ctx.openCandidates.length} open candidate(s).`,
          limitations: ["Soft-semantic conflicts are signals, not verdicts; System One interference is attached when available."],
        };
      }
      case "model-rules":
        return modelRulesHook(st, h);
      case "system-one":
      case "llm": {
        const j = llmJudgment(h, c);
        if (j === "reviewDelta" || j === "topology") {
          if (cand.target !== "genome") return aggregate([], `${j} (app candidate has no Genome delta)`);
          return aggregate(reviewsAsJudged((await reviewsFor(st)).filter((r) => r.judgment === j)), j);
        }
        if (j === "purposeMeasures") {
          const m = cand.target === "genome" ? rulesFor(st, null).model : st.base;
          if (!m) return errored(new Error("Genome candidate does not load; purpose measures cannot be judged"));
          return aggregate(reviewsAsJudged(await judgePurpose(s1, m)), j);
        }
        if (j === "interference") {
          const judged = (await conflictsFor(st)).filter((r) => r.semantic).map((r) => ({
            subject: r.candidates.join("+"),
            // Proposition "they interfere": confirmed → fail, ruled out → pass.
            verdict: r.semantic!.verdict === "pass" ? ("fail" as const) : r.semantic!.verdict === "fail" ? ("pass" as const) : ("unknown" as const),
            provenance: r.semantic!.provenance,
          }));
          return aggregate(judged, j);
        }
        return errored(new Error(`Unknown llm judgment "${j}" on ${h.id}`));
      }
      case "http":
        return httpHealth({ previewUrl: cand.previewUrl, commit: cand.commit, path: h.inputs.path, timeoutMs: Math.min(h.timeoutMs, HEALTH_TIMEOUT_MS), fetch: deps.fetch });
      default:
        return notRun(`Engine ${h.engine} is not run by the platform.`);
    }
  }

  /** Criteria named in `inputs.requires` must exist in the judged model and not be deferred. */
  function requiresCheck(st: RunState, h: schema.AssayHook): { missing: string[] } | null {
    const ids = (h.inputs.requires ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return null;
    const m = st.ctx.candidate.target === "genome" ? rulesFor(st, null).model ?? st.base : st.base;
    const present = new Set(m.criteria.filter((c) => !c.deferred).map((c) => c.id));
    return { missing: ids.filter((id) => !present.has(id)) };
  }

  /**
   * `inputs.check` items (C.system.promotion). Each yields a part; promotion-only facts come from
   * `ctx.promotionFacts` and are `not-run` when absent.
   */
  function promotionCheck(st: RunState, check: string): Outcome {
    const c = st.ctx.candidate;
    const facts = st.ctx.promotionFacts;
    const fact = (v: boolean | undefined, okText: string, failText: string): Outcome =>
      v === undefined
        ? notRun(`${check} is established by the DO at promotion (ctx.promotionFacts not supplied).`)
        : { execution: "completed", verdict: v ? "pass" : "fail", observations: [], interpretation: v ? okText : failText, limitations: [] };
    switch (check) {
      case "scope-authorized":
        return diffScope({ target: c.target, changedPaths: c.changedPaths, changedNodes: c.changedNodes, permitted: st.ctx.permittedPaths, protected: st.ctx.protectedPaths });
      case "base-current":
        return facts?.currentBaseCommit === undefined
          ? notRun("base-current needs the current head (ctx.promotionFacts.currentBaseCommit).")
          : fact(facts.currentBaseCommit === c.baseCommit, "Candidate base is the current head.", `Stale base: candidate is based on ${c.baseCommit.slice(0, 12)}, head is ${facts.currentBaseCommit.slice(0, 12)}.`);
      case "manifest-exact":
        return fact(facts?.manifestExact, "Manifest binds exactly this candidate.", "Manifest does not match the candidate.");
      case "evidence-fresh":
        return fact(facts?.evidenceFresh, "Required evidence is fresh for this commit.", "Required evidence is stale or belongs to another candidate.");
      default:
        return errored(new Error(`Unknown check "${check}"`));
    }
  }

  function modelRulesHook(st: RunState, h: schema.AssayHook): Outcome {
    const checks = (h.inputs.check ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const parts: { check: string; o: Outcome }[] = [];
    if (!checks.length || h.inputs.packs || h.inputs.rulePrefix) parts.push({ check: "rules", o: rulesFor(st, h).outcome });
    for (const check of checks) {
      let o: Outcome;
      try {
        o = promotionCheck(st, check);
      } catch (e) {
        o = errored(e);
      }
      parts.push({ check, o });
    }
    const req = requiresCheck(st, h);
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
    return {
      execution: ran ? "completed" : parts.some((p) => p.o.execution === "error") ? "error" : "not-run",
      verdict: failed.length ? "fail" : allPass ? "pass" : "unknown",
      observations: parts.flatMap((p) =>
        p.check === "rules" || p.check === "requires"
          ? p.o.observations
          : [{ check: p.check, execution: p.o.execution, verdict: p.o.verdict, interpretation: p.o.interpretation, observations: p.o.observations, limitations: p.o.limitations }]),
      interpretation: parts.map((p) => `${p.check}: ${p.o.verdict}${p.o.verdict === "pass" ? "" : ` (${p.o.interpretation ?? p.o.limitations.join("; ")})`}`).join("; "),
      limitations: parts.flatMap((p) => (p.check === "rules" || p.check === "requires" ? p.o.limitations : [])),
      provenance: parts.find((p) => p.check === "rules")?.o.provenance,
    };
  }

  function targetRef(st: RunState, h: schema.AssayHook | null): string {
    const c = st.ctx.candidate;
    if (h?.engine === "model-rules") return c.target === "genome" ? `genome@${c.commit}` : `genome@${st.ctx.genomeCommit}`;
    if (h?.engine === "http" && c.previewUrl) return c.previewUrl;
    return `${c.target}@${c.commit}`;
  }

  async function evaluate(st: RunState): Promise<Evaluation[]> {
    const selected = selectHooks(st.base, st.ctx.candidate);
    const cache = new Map<string, Promise<{ o: Outcome; startedAt: string; finishedAt: string }>>();
    const out: Evaluation[] = [];
    for (const s of selected) {
      const hook = s.hook ?? NO_HOOK;
      let res: { o: Outcome; startedAt: string; finishedAt: string };
      if (!s.run || !s.hook) {
        const t = now();
        res = { o: notRun(s.skip ?? "Not run.", { provenance: { reason: s.reason, ...(s.hook && { binding: s.hook.binding }) } }), startedAt: t, finishedAt: t };
      } else {
        const h = s.hook;
        // Per-hook cache, except where the outcome depends on the criterion (llm judgment inference).
        const key = h.engine === "llm" ? `${h.id}\u0000${s.criterion.id}` : h.id;
        let p = cache.get(key);
        if (!p) {
          p = (async () => {
            const startedAt = now();
            let o: Outcome;
            try {
              o = await engine(st, h, s.criterion);
            } catch (e) {
              o = errored(e, { interpretation: `Hook ${h.id} (${h.engine}) threw.` });
            }
            return { o, startedAt, finishedAt: now() };
          })();
          cache.set(key, p);
        }
        res = await p;
      }
      const o: Outcome = {
        ...res.o,
        observations: [...res.o.observations],
        limitations: [...res.o.limitations, ...s.notes],
        provenance: { ...res.o.provenance, selectedBy: s.reason, ...(s.hook && { binding: s.hook.binding }) },
      };
      out.push(toEvaluation({ candidate: st.ctx.candidate.id, hook, criterion: s.criterion, targetRef: targetRef(st, s.hook), startedAt: res.startedAt, finishedAt: res.finishedAt }, o));
    }
    return out;
  }

  /** Readiness for a Genome candidate that failed before rules ran (parse error or engine error). */
  function failedReadiness(r: ModelRulesResult): Readiness {
    const parse = r.outcome.observations.find((x) => (x as { kind?: string }).kind === "parse-error");
    const rule = parse ? "genome.parse" : "genome.rules-error";
    const message = r.outcome.interpretation ?? r.outcome.observations.map((x) => JSON.stringify(x)).join("; ");
    return {
      snapshotHash: "",
      packs: [],
      findings: [{ level: "error", rule, message, facts: [], derivation: { relation: rule, tuple: [], edb: true, children: [] } }],
      derived: {},
      incomplete: r.outcome.execution === "error",
      actionable: false,
    };
  }

  return {
    async runSubmission(ctx) {
      const st: RunState = { ctx, base: loadBase(ctx) };
      return evaluate(st);
    },

    async runGenome(ctx: GenomeContext): Promise<GenomeResult> {
      if (ctx.candidate.target !== "genome" || !ctx.candidate.genomeFiles) {
        throw new Error(`runGenome needs a Genome candidate with genomeFiles (got target ${ctx.candidate.target}${ctx.candidate.genomeFiles ? "" : ", no genomeFiles"})`);
      }
      const st: RunState = { ctx, base: loadBase(ctx) };
      const rules = rulesFor(st, null);
      const readiness = rules.readiness ?? failedReadiness(rules);
      const review = await reviewsFor(st);
      const evaluations = await evaluate(st);
      return { readiness, review, evaluations };
    },

    async conflicts(ctx) {
      return computeConflicts(ctx, loadBase(ctx), { s1, genome: deps.genome });
    },
  };
}
