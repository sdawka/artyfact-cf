import { canon } from "../canon.ts";
import { evaluate, type EvaluateOptions, type Readiness } from "../evaluate/evaluate.ts";
import { compareFindings, verdicts, type Finding } from "../evaluate/findings.ts";
import { parseGraph, type Graph } from "../graph/graph.ts";
import type { Template } from "../meta/template.ts";
import { DEFECTS, defectPath, mergeDefects } from "./defects.ts";
import type { Explainer } from "./explain.ts";
import {
  askBatch, budgetLeftovers, resolveMirrors, DEFAULT_TEXTS, expand, funnelContext, probeTextsOf, group, limitsOf, reconcileParents, seed, settle, termItems,
  type FunnelContext, type Item, type Limits, type Step, type Track,
} from "./funnel.ts";
import { pairOf } from "./slice.ts";
import { thresholdsOf } from "./policy.ts";
import type { AskOptions, SystemOne, Thresholds } from "./types.ts";

export interface JudgeOptions {
  thresholds?: Partial<Thresholds>;
  ask?: AskOptions;
  /** Writes advisory prose for confirmed consistency and coherence findings; never read for level or status. */
  explainer?: Explainer;
  limits?: Partial<Limits>;
  /**
   * Statement fields that make a node a member or section. Default: the `probeText` fields of the template's
   * `semantic.probe` pack, else `["description"]`, so the funnel and the pack agree.
   */
  texts?: string[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/**
 * `compareFindings`, then the judged question, state hash and canonical JSON, so the order is total and does not
 * depend on when concurrent provider calls returned.
 */
export function sortTotal(findings: Finding[]): Finding[] {
  const keyed = findings.map((f) => ({ f, c: undefined as string | undefined }));
  const canonOf = (x: { f: Finding; c?: string }) => (x.c ??= canon(x.f));
  return keyed.sort((a, b) => compareFindings(a.f, b.f)
    || cmp(a.f.judgment?.question ?? "", b.f.judgment?.question ?? "")
    || cmp(a.f.provenance?.stateHash ?? "", b.f.provenance?.stateHash ?? "")
    || cmp(canonOf(a), canonOf(b))).map((x) => x.f);
}

/** Defect families whose confirmed findings are explained. */
const EXPLAINED_FAMILIES = new Set(["consistency", "coherence"]);

/** The bounded round loop: ask every queued batch, expand follow-ups, until nothing is queued or a budget runs out. */
async function rounds(ctx: FunnelContext, queue: Item[]): Promise<number> {
  let round = 0;
  while (queue.length && round < ctx.limits.maxRounds) {
    round++;
    const batches = group(queue, ctx);
    const cut: Item[] = [];
    const running: Promise<{ judged: [Item, Step][]; cut: Item[] }>[] = [];
    for (const b of batches) {
      if (ctx.calls >= ctx.limits.maxCalls) { cut.push(...b.items); continue; }
      ctx.calls++;
      running.push(askBatch(b, ctx, round));
    }
    const results = await Promise.all(running);
    // Expanded in batch order, so memo hits and finding order do not depend on reply timing.
    const next: Item[] = [];
    for (const r of results) {
      cut.push(...r.cut);
      // An item, its polarity partner and the companions it brought share one set of followed asks.
      const fired = new Map<Track, Set<string>>();
      for (const [item, step] of r.judged) {
        const owner = item.via ?? item.track;
        if (!fired.has(owner)) fired.set(owner, new Set());
        next.push(...expand(item, step, ctx, round + 1, fired.get(owner)));
      }
    }
    budgetLeftovers(cut, ctx);
    queue = next;
  }
  budgetLeftovers(queue, ctx);
  return round;
}

async function explainAll(ctx: FunnelContext, findings: Map<Track, Finding>, template: Template, explainer: Explainer, max: number): Promise<number> {
  const { defects } = mergeDefects(DEFECTS, template.defects);
  const family = (id: string) => defectPath(id, defects)[0]?.id;
  const due = [...findings].filter(([, f]) => f.judgment?.status === "confident" && (f.level === "error" || f.level === "warning")
    && f.judgment.defect !== undefined && EXPLAINED_FAMILIES.has(family(f.judgment.defect) ?? ""))
    .sort(([, a], [, b]) => compareFindings(a, b)).slice(0, max);
  let explained = 0;
  for (const [t, f] of due) {
    const step = t.steps.find((s) => s.question.id === f.judgment!.question && s.decision.answer === f.judgment!.answer) ?? t.steps[t.steps.length - 1]!;
    const subject = f.subject ?? "";
    const subjects = pairOf(subject, (id) => ctx.byId.has(id)) ?? [subject];
    const req = { defect: f.judgment!.defect!, question: f.judgment!.question, answer: f.judgment!.answer ?? "", subjects: [...subjects] };
    let explanation;
    try {
      explanation = await explainer.explain(step.state, req);
    } catch (e) {
      explanation = { provider: "error", model: explainer.model, error: String((e as Error)?.message ?? e) };
    }
    if (!explanation || typeof explanation !== "object") explanation = { provider: "error", model: explainer.model, error: "explainer returned no result" };
    if (!explanation.error) explained++;
    const { text: _text, ...meta } = explanation;
    findings.set(t, { ...f, judgment: { ...f.judgment!, explanation }, provenance: { ...f.provenance!, explained: meta } });
  }
  return explained;
}

/**
 * Resolves every semantic candidate through the question funnel and applies policy. Never throws on provider or
 * explainer failure. A template whose questions declare no `next` or `batchWith` asks one question per candidate.
 */
export async function judge(readiness: Readiness, template: Template, input: Graph | unknown, s1: SystemOne, opts: JudgeOptions = {}): Promise<Readiness> {
  const t = thresholdsOf(opts.thresholds);
  const limits = limitsOf(opts.limits);
  const g = parseGraph(input);
  const ctx = funnelContext(g, new Map(template.questions.map((q) => [q.id, q])), s1, t, limits, opts.ask,
    opts.texts ?? probeTextsOf(template.rules) ?? DEFAULT_TEXTS);

  const seeded = seed(readiness.findings, ctx);
  const roots = [...ctx.tracks];
  const queue = [...seeded.items, ...termItems(ctx, roots)];
  const roundsRun = await rounds(ctx, queue);

  resolveMirrors(ctx.tracks);
  const settled = new Map<Track, Finding>(ctx.tracks.map((tr) => [tr, settle(tr, ctx)]));
  reconcileParents(ctx.tracks, settled);
  const explained = opts.explainer ? await explainAll(ctx, settled, template, opts.explainer, limits.maxExplanations) : 0;

  const findings = sortTotal([...seeded.passthrough, ...seeded.fixed, ...settled.values()]);
  const count = (s: string) => findings.filter((f) => f.judgment?.status === s).length;
  return {
    ...readiness,
    findings,
    judgments: {
      confident: count("confident"), review: count("review"), unknown: count("unknown"),
      calls: ctx.calls, rounds: roundsRun, gated: ctx.gated, budget: ctx.exhausted ? "exhausted" : "ok", explained,
    },
    ...verdicts(findings, readiness.incomplete),
  };
}

export const evaluateAndJudge = (template: Template, graph: Graph | unknown, s1: SystemOne, opts: EvaluateOptions & JudgeOptions = {}): Promise<Readiness> =>
  judge(evaluate(template, graph, opts), template, graph, s1, opts);
