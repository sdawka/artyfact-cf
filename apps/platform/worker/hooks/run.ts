/**
 * HookRunner implementation: selects a candidate's hooks from the canonical Genome and dispatches by `hook.engine`.
 *
 * Hook selection (base Genome at `ctx.genomeCommit`):
 *   affected criteria = acceptance criteria of the candidate's Evolution        (reason "acceptance")
 *                       (the Genome's Evolution, else the DO's record `ctx.evolution` for API-created ones)
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
import type { CandidateRef, ConflictContext, EvolutionRef, ConflictReport, DeltaReview, Evaluation, GenomeContext, GenomeResult, HookRunner, SubmissionContext } from "./contract";
import { diffScope } from "./diff-scope";
import { HEALTH_TIMEOUT_MS, httpHealth, previewPolicy, type PreviewEnv } from "./http-health";
import { manifestExists } from "./manifest-exists";
import { modelRulesHook } from "./model-checks";
import { filterFromInputs, loadGenome, modelRules, selectableRules, type GenomeDeps, type ModelRulesResult } from "./model-rules";
import { computeConflicts } from "./overlap";
import { errored, errorMessage, notRun, toEvaluation, type Outcome } from "./provenance";
import { aggregate, judgePurpose, judgeTopology, reviewGenome, reviewsAsJudged, reviewUnavailable } from "./system-one";

export interface RunnerDeps {
  /** System One client; defaults to `createSystemOne(s1Env ?? {})` (provider off when no key). */
  s1?: SystemOne;
  s1Env?: SystemOneEnv;
  /** Preview URL policy env (ALLOW_LOCAL_PREVIEW, PREVIEW_HOST_ALLOWLIST). The Worker wiring passes `env`. Absent → defaults only. */
  previewEnv?: PreviewEnv;
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
const PROMOTION_TRIGGERS = new Set<schema.Gate>(["submission", "candidate", "promotion"]);

/** A stand-in for an acceptance criterion id the Genome does not define, so the gap still shows. */
function phantomCriterion(id: string, m: SystemModel): schema.Criterion {
  return {
    id, version: 1, title: id, claim: "(criterion not found in the Genome)", ownerKind: "system", ownerId: m.system.id,
    subjectKind: "system", subjectId: m.system.id, targetKind: "model", sourceRefs: [], refines: [], satisfies: [],
    severity: "hard", gates: [], deferred: false, hooks: [],
  };
}

/**
 * `stored`: the candidate's Evolution as the DO knows it, used only when the Genome does not declare it (Evolutions
 * created through the API live only in the DO). Missing from both → the phantom `C.evolution-missing.<id>`.
 */
export function selectHooks(m: SystemModel, candidate: CandidateRef, trigger: "submission" | "promotion" = "submission", stored?: EvolutionRef): Selected[] {
  const runsOn = trigger === "promotion" ? PROMOTION_TRIGGERS : SUBMISSION_TRIGGERS;
  const criteria = new Map(m.criteria.map((c) => [c.id, c] as const));
  const hooks = new Map(m.hooks.map((h) => [h.id, h] as const));
  const evolution: Pick<EvolutionRef, "acceptanceCriteria"> | undefined =
    m.evolutions.find((e) => e.id === candidate.evolutionId) ?? (stored?.id === candidate.evolutionId ? stored : undefined);
  const notes = evolution ? [] : [`Evolution ${candidate.evolutionId} is not in the Genome at base; its acceptance criteria are unknown.`];
  const changed = new Set(candidate.changedNodes);

  const picked: { c: schema.Criterion; reason: SelectionReason; phantom?: boolean }[] = [];
  const seen = new Set<string>();
  const add = (c: schema.Criterion, reason: SelectionReason, phantom = false) => {
    if (seen.has(c.id) || c.deferred) return;
    seen.add(c.id);
    picked.push({ c, reason, phantom });
  };
  if (!evolution) add(phantomCriterion(`C.evolution-missing.${candidate.evolutionId}`, m), "acceptance", true);
  for (const id of evolution?.acceptanceCriteria ?? []) {
    const c = criteria.get(id);
    add(c ?? phantomCriterion(id, m), "acceptance", !c);
  }
  for (const c of m.criteria) if (changed.has(c.subjectId)) add(c, "subject");
  for (const c of m.criteria) {
    if (c.ownerKind === "system" && (c.gates.includes("submission") || (trigger === "promotion" && c.gates.includes("promotion")))) add(c, "system-gate");
  }

  const out: Selected[] = [];
  for (const { c, reason, phantom } of picked) {
    if (phantom) {
      const skip = evolution ? `Acceptance criterion ${c.id} is not defined in the Genome.` : notes[0];
      out.push({ criterion: c, hook: null, reason, run: false, skip, notes });
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
      else if (h.engine !== "http" && !h.triggers.some((t) => runsOn.has(t))) skip = `Triggers [${h.triggers.join(", ")}] do not include ${trigger === "promotion" ? "submission, candidate or promotion" : "submission or candidate"}.`;
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

/** `inputs.mode`, else inferred from id/assay (flagged so the Evaluation says so). */
function diffMode(h: schema.AssayHook): { mode: "scope" | "overlap"; inferred: boolean } {
  const mode = h.inputs.mode?.trim();
  if (mode === "overlap" || mode === "scope") return { mode, inferred: false };
  return { mode: /overlap/i.test(`${h.id} ${h.assay}`) ? "overlap" : "scope", inferred: true };
}

/** `inputs.judgment`, else inferred from the criterion id (flagged). */
function llmJudgment(h: schema.AssayHook, c: schema.Criterion): { judgment: string; inferred: boolean } {
  const j = h.inputs.judgment?.trim();
  if (j) return { judgment: j, inferred: false };
  const judgment = /purpose/i.test(c.id) ? "purposeMeasures" : /topology/i.test(c.id) ? "topology" : "reviewDelta";
  return { judgment, inferred: true };
}

const withLimitation = (o: Outcome, text: string): Outcome => ({ ...o, limitations: [...o.limitations, text] });

const MULTI_RECIPIENT = "topology.multiRecipient";
/** The pack that emits `semanticCandidate("topology.multiRecipient", …)`. */
const TOPOLOGY_PACK = "topology.private-pairs";
const touchedCount = (d: { added: string[]; removed: string[]; changed: unknown[] }) => d.added.length + d.removed.length + d.changed.length;

/** The model-rules run for this candidate completed fully: its (absence of) outputs is evidence. */
const rulesSound = (r: ModelRulesResult) => !!r.model && !!r.readiness && !r.readiness.incomplete && r.outcome.execution === "completed";

function rulesUnsound(r: ModelRulesResult, what: string): Outcome {
  const why = !r.model ? "the Genome does not load" : !r.readiness ? "its rules run failed" : r.readiness.incomplete ? "its rules run is incomplete" : `its rules run did not complete (${r.outcome.execution})`;
  return { execution: "completed", verdict: "unknown", observations: [], interpretation: `${what} cannot be judged: ${why}.`, limitations: ["No sound rules run to establish what needs judging."] };
}

/**
 * Ruling: a System One hook whose input set is empty because a complete, sound rules run flagged nothing passes by
 * that evidence (topology with zero candidates from a pack that ran; reviewDelta with an empty Genome delta).
 * purposeMeasures with zero claims is NOT vacuous (readiness gap → unknown). Nothing is sent to System One.
 */
function vacuous(r: ModelRulesResult, counts: Record<string, number>, what: string): Outcome {
  return {
    execution: "completed",
    verdict: "pass",
    observations: [{ ...counts, rulesRun: r.readiness?.snapshotHash ?? "" }],
    interpretation: `${what}: nothing to judge.`,
    limitations: ["vacuous: no candidates flagged by the rules; nothing was judged"],
    provenance: { provider: "none", rulesRun: r.readiness?.snapshotHash ?? "" },
  };
}

export function createHookRunner(deps: RunnerDeps = {}): HookRunner {
  const s1 = deps.s1 ?? createSystemOne(deps.s1Env ?? {});
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const policy = previewPolicy(deps.previewEnv ?? {});

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
    if (r.model && r.delta && r.readiness) {
      st.reviews = await reviewGenome(s1, st.base, r.model, r.delta, r.readiness.derived);
    } else {
      const why = !r.model ? `the Genome candidate does not load (${r.outcome.interpretation ?? "see the structure evaluation"})`
        : !r.readiness ? "the rules run failed" : `the semantic delta vs base is unavailable (${r.outcome.limitations.join("; ")})`;
      st.reviews = [reviewUnavailable(st.ctx.candidate.id, `System One review did not run: ${why}.`)];
    }
    return st.reviews;
  }

  async function engine(st: RunState, h: schema.AssayHook, c: schema.Criterion): Promise<Outcome> {
    const cand = st.ctx.candidate;
    switch (h.engine) {
      case "manifest":
        return manifestExists(st.ctx.tree, h.inputs);
      case "diff": {
        const { mode, inferred } = diffMode(h);
        const o = await diffEngine(st, mode);
        return inferred ? withLimitation(o, `inputs.mode is not set; ran as ${mode} (inferred from the hook id/assay).`) : o;
      }
      case "model-rules":
        return modelRulesHook({ ctx: st.ctx, base: st.base, rules: (x) => rulesFor(st, x) }, h);
      case "system-one":
      case "llm": {
        const { judgment, inferred } = llmJudgment(h, c);
        let o = await semanticEngine(st, h, judgment);
        if (inferred) o = withLimitation(o, `inputs.judgment is not set; ran ${judgment} (inferred from ${c.id}).`);
        const ignored = Object.keys(h.inputs).filter((k) => k !== "judgment");
        if (ignored.length) o = withLimitation(o, `System One hook inputs ${ignored.join(", ")} ignored by the ${judgment} judgment.`);
        return o;
      }
      case "http":
        return httpHealth({ previewUrl: cand.previewUrl, commit: cand.commit, path: h.inputs.path, timeoutMs: Math.min(h.timeoutMs, HEALTH_TIMEOUT_MS), fetch: deps.fetch, policy });
      default:
        return notRun(`Engine ${h.engine} is not run by the platform.`);
    }
  }

  async function diffEngine(st: RunState, mode: "scope" | "overlap"): Promise<Outcome> {
    const cand = st.ctx.candidate;
    if (mode === "scope") {
      return diffScope({ target: cand.target, changedPaths: cand.changedPaths, changedNodes: cand.changedNodes, pathNodes: cand.pathNodes, permitted: st.ctx.permittedPaths, protected: st.ctx.protectedPaths });
    }
    const reports = await conflictsFor(st);
    const hard = reports.filter((r) => r.kind === "hard-semantic");
    const errors = reports.filter((r) => r.error);
    return {
      execution: "completed",
      // pass only with no conflicts at all; hard-semantic fails; file / soft-semantic (and undeterminable
      // overlap) stay unknown until the reviewer resolves them.
      verdict: hard.length ? "fail" : reports.length ? "unknown" : "pass",
      observations: reports,
      interpretation: reports.length
        ? `${reports.length} conflict(s) with open candidates: ${reports.map((r) => `${r.kind} with ${r.candidates[1]}`).join("; ")}.`
        : `No overlap with ${st.ctx.openCandidates.length} open candidate(s).`,
      limitations: [
        ...(reports.length && !hard.length ? ["File and soft-semantic conflicts are unknown, not pass: a reviewer must resolve or sequence them."] : []),
        ...errors.map((r) => `Overlap with ${r.candidates[1]} could not be fully determined: ${r.error}`),
      ],
    };
  }

  async function semanticEngine(st: RunState, h: schema.AssayHook, j: string): Promise<Outcome> {
    const cand = st.ctx.candidate;
    if (j === "reviewDelta") {
      if (cand.target !== "genome") return aggregate([], "reviewDelta (app candidate has no Genome delta)");
      const r = rulesFor(st, null);
      const reviews = (await reviewsFor(st)).filter((x) => x.judgment === j);
      if (rulesSound(r) && r.delta && touchedCount(r.delta) === 0) return vacuous(r, { changes: 0 }, j);
      return aggregate(reviewsAsJudged(reviews), j);
    }
    if (j === "topology") {
      // Judge every multi-recipient candidate of the judged model: the candidate Genome, or the canonical one for
      // app candidates (whose Genome is unchanged).
      const r = rulesFor(st, null);
      if (!rulesSound(r)) return rulesUnsound(r, j);
      const flagged = (r.readiness!.derived.semanticCandidate ?? []).filter((t) => t[0] === MULTI_RECIPIENT);
      if (flagged.length === 0) {
        // Zero candidates is evidence only if a pack that emits this family actually ran.
        if (!selectableRules(r.packs ?? [], { rulePrefix: `semantic:${MULTI_RECIPIENT}` }).length) {
          return { execution: "completed", verdict: "unknown", observations: [{ note: `pack not run: ${TOPOLOGY_PACK}` }], interpretation: `topology cannot be judged: no pinned pack flags ${MULTI_RECIPIENT} candidates.`, limitations: [`pack not run: ${TOPOLOGY_PACK}`] };
        }
        return vacuous(r, { semanticCandidates: 0 }, j);
      }
      return aggregate(reviewsAsJudged(await judgeTopology(s1, r.model!, r.readiness!.derived)), j);
    }
    if (j === "purposeMeasures") {
      const r = rulesFor(st, null);
      if (!rulesSound(r)) return rulesUnsound(r, j);
      // Ruling: absence of theory is a readiness gap, not evidence.
      if (r.model!.claims.filter((c) => !c.deferred).length === 0) {
        return { execution: "completed", verdict: "unknown", observations: [{ note: "no non-deferred claims" }], interpretation: "purposeMeasures: no non-deferred claims to judge.", limitations: ["no non-deferred claims"] };
      }
      return aggregate(reviewsAsJudged(await judgePurpose(s1, r.model!)), j);
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
    return errored(new Error(`Unknown System One judgment "${j}" on ${h.id}`));
  }

  function targetRef(st: RunState, h: schema.AssayHook | null): string {
    const c = st.ctx.candidate;
    if (h?.engine === "model-rules") return c.target === "genome" ? `genome@${c.commit}` : `genome@${st.ctx.genomeCommit}`;
    if (h?.engine === "http" && c.previewUrl) return c.previewUrl;
    return `${c.target}@${c.commit}`;
  }

  async function evaluate(st: RunState): Promise<Evaluation[]> {
    const selected = selectHooks(st.base, st.ctx.candidate, st.ctx.trigger, st.ctx.evolution);
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
