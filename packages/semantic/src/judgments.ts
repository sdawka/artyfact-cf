// Judgments: run questions through System One and apply deterministic policy.
// The model proposes; this file (with policy.ts) decides. Failures never throw: they map to
// `unknown` / `info` with provenance.provider 'off' | 'error'.
import { hashOf } from './hash';
import type { Commitment, EvolutionSummary, OntologyNode, SemanticChange, SemanticDelta, SemanticModel, TheoryClaim } from './model-types';
import { PRIVATE_PAIRS_PROFILE } from './model-types';
import { choiceOutcome, verdict as verdictOf } from './policy';
import {
  classifyStatementQuestions,
  classifyStatementState,
  interferenceQuestions,
  interferenceState,
  purposeMeasureQuestions,
  purposeMeasureState,
  reviewDeltaQuestions,
  reviewDeltaState,
  topologyQuestions,
  topologyState,
  type AttachCandidate,
  type KindOption,
} from './questions';
import type { Answer, Level, Provenance, Questions, S1Reply, SystemOne, Verdict } from './types';

export type ChoiceJudgment = { choice: string; outcome: string; probabilities: Record<string, number>; confidence: number };
export type ScoreJudgment = { score: number; probabilities: Record<string, number>; confidence: number };

type Run = { reply: S1Reply | null; provenance: Provenance };

async function run(s1: SystemOne, state: unknown, questions: Questions): Promise<Run> {
  const [stateHash, questionHash] = await Promise.all([hashOf(state), hashOf(questions)]);
  try {
    const reply = await s1.ask(state, questions);
    return { reply, provenance: { provider: reply.provider, model: reply.model, questionHash, stateHash, ms: reply.ms, usage: reply.usage } };
  } catch {
    return {
      reply: null,
      provenance: {
        provider: s1.mode === 'off' ? 'off' : 'error',
        model: s1.model,
        questionHash,
        stateHash,
        ms: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }
}

const get = (r: Run, id: string): Answer | undefined => r.reply?.answers[id];
const noul = (r: Run, id: string): number | null => {
  const a = get(r, id);
  return a?.type === 'noul' && typeof a.noul === 'number' ? a.noul : null;
};
const choice = (r: Run, id: string): ChoiceJudgment | null => {
  const a = get(r, id);
  return a?.type === 'choice' ? { choice: a.choice, outcome: choiceOutcome(a), probabilities: a.probabilities, confidence: a.confidence } : null;
};
const score = (r: Run, id: string): ScoreJudgment | null => {
  const a = get(r, id);
  return a?.type === 'score' ? { score: a.score, probabilities: a.probabilities, confidence: a.confidence } : null;
};

// ── reviewDelta ──────────────────────────────────────────────────────────────────────────────────
export type ReviewResult = {
  id: string;
  changeClass: ChoiceJudgment | null;
  contradicts: Record<string, number>;
  weakens: number | null;
  specificity: ScoreJudgment | null;
  touchesConsent: number | null;
  level: Level;
  verdict: Verdict;
  provenance: Provenance;
};

export function reviewLevel(signals: { hardRule: number | null; contradicts: number[]; weakens: number | null }): Level {
  const strong = Math.max(signals.hardRule ?? 0, ...signals.contradicts);
  if (strong >= 0.9) return 'error';
  if (strong >= 0.5 || (signals.weakens ?? 0) >= 0.5) return 'warning';
  return 'info';
}

async function reviewOne(s1: SystemOne, m: SemanticModel, change: SemanticChange, commitments: Commitment[]): Promise<ReviewResult> {
  const r = await run(s1, reviewDeltaState(m, change, commitments, m.governing), reviewDeltaQuestions(change, commitments, m.governing));
  if (!r.reply) {
    return { id: change.id, changeClass: null, contradicts: {}, weakens: null, specificity: null, touchesConsent: null, level: 'info', verdict: 'unknown', provenance: r.provenance };
  }
  const changeClass = choice(r, 'changeClass');
  const contradicts: Record<string, number> = {};
  for (const c of commitments) {
    const p = noul(r, `contradicts.${c.id}`);
    if (p !== null) contradicts[c.id] = p;
  }
  const weakens = noul(r, 'weakens');
  const hardRule = changeClass?.choice === 'hard-rule-violation' ? (changeClass.probabilities['hard-rule-violation'] ?? changeClass.confidence) : (changeClass?.probabilities['hard-rule-violation'] ?? null);
  const level = reviewLevel({ hardRule, contradicts: Object.values(contradicts), weakens });
  // Pass only when every harmful signal is confidently absent and the class is confidently benign.
  const clean =
    Object.keys(contradicts).length === commitments.length &&
    Object.values(contradicts).every((p) => verdictOf(p) === 'fail') &&
    verdictOf(weakens) === 'fail' &&
    changeClass !== null &&
    (changeClass.outcome === 'clarification' || changeClass.outcome === 'deliberate-nonstandard-choice');
  const verdict: Verdict = level === 'error' ? 'fail' : clean ? 'pass' : 'unknown';
  return { id: change.id, changeClass, contradicts, weakens, specificity: score(r, 'specificity'), touchesConsent: noul(r, 'touchesConsent'), level, verdict, provenance: r.provenance };
}

export const reviewDelta = (s1: SystemOne, m: SemanticModel, delta: SemanticDelta, commitments: Commitment[]): Promise<ReviewResult[]> =>
  Promise.all(delta.changes.map((c) => reviewOne(s1, m, c, commitments)));

// ── topology ─────────────────────────────────────────────────────────────────────────────────────
export type TopologyCandidate = { node: OntologyNode; profile?: string };
export type TopologyResult = {
  nodeId: string;
  multiRecipient: number | null;
  isPublication: number | null;
  /** Verdict on the proposition "this sends to more than one person": pass = confirmed, fail = ruled out. */
  verdict: Verdict;
  provenance: Provenance;
};

export const topology = (s1: SystemOne, candidates: TopologyCandidate[]): Promise<TopologyResult[]> =>
  Promise.all(
    candidates.map(async ({ node, profile = PRIVATE_PAIRS_PROFILE }) => {
      const r = await run(s1, topologyState(node, profile), topologyQuestions(node, profile));
      const multiRecipient = noul(r, 'multiRecipient');
      return { nodeId: node.id, multiRecipient, isPublication: noul(r, 'isPublication'), verdict: verdictOf(multiRecipient), provenance: r.provenance };
    }),
  );

// ── purposeMeasures ──────────────────────────────────────────────────────────────────────────────
export type PurposeMeasureResult = {
  claimId: string;
  engagementSubstitute: number | null;
  outcomeNotOutput: number | null;
  measurable: ScoreJudgment | null;
  /** pass: a sound measure; fail: engagement stand-in, output-not-outcome, or unobservable; else unknown. */
  verdict: Verdict;
  provenance: Provenance;
};

export const purposeMeasures = (s1: SystemOne, purpose: string, claims: TheoryClaim[]): Promise<PurposeMeasureResult[]> =>
  Promise.all(
    claims.map(async (claim) => {
      const r = await run(s1, purposeMeasureState(purpose, claim), purposeMeasureQuestions(purpose, claim));
      const engagementSubstitute = noul(r, 'engagementSubstitute');
      const outcomeNotOutput = noul(r, 'outcomeNotOutput');
      const measurable = score(r, 'measurable');
      const eng = verdictOf(engagementSubstitute);
      const out = verdictOf(outcomeNotOutput);
      const measurableConfident = measurable !== null && measurable.confidence >= 0.5;
      let verdict: Verdict = 'unknown';
      if (eng === 'pass' || out === 'fail' || (measurableConfident && measurable.score === 0)) verdict = 'fail';
      else if (eng === 'fail' && out === 'pass' && measurableConfident && measurable.score >= 1) verdict = 'pass';
      return { claimId: claim.id, engagementSubstitute, outcomeNotOutput, measurable, verdict, provenance: r.provenance };
    }),
  );

// ── interference ─────────────────────────────────────────────────────────────────────────────────
export type InterferenceResult = {
  interferes: number | null;
  needsComposition: number | null;
  /** Verdict on the proposition "the changes interfere": pass = confirmed, fail = ruled out. */
  verdict: Verdict;
  provenance: Provenance;
};

export async function interference(
  s1: SystemOne,
  a: EvolutionSummary,
  b: EvolutionSummary,
  shared: unknown,
  extra: { journeys?: string[]; criteria?: unknown[] } = {},
): Promise<InterferenceResult> {
  const r = await run(s1, interferenceState(a, b, shared, extra.journeys, extra.criteria), interferenceQuestions(a, b, shared));
  const interferes = noul(r, 'interferes');
  return { interferes, needsComposition: noul(r, 'needsComposition'), verdict: verdictOf(interferes), provenance: r.provenance };
}

// ── classifyStatements ───────────────────────────────────────────────────────────────────────────
export type StatementProposal = {
  sentence: string;
  kind: ChoiceJudgment | null;
  attachTo: ChoiceJudgment | null;
  isDistinctiveChoice: number | null;
  verdict: Verdict;
  provenance: Provenance;
};

/** Proposals only: nothing is written without acceptance. `verdict` is on isDistinctiveChoice. */
export const classifyStatements = (s1: SystemOne, sentences: string[], kinds: KindOption[], candidates: AttachCandidate[]): Promise<StatementProposal[]> =>
  Promise.all(
    sentences.map(async (sentence) => {
      const r = await run(s1, classifyStatementState(sentence, candidates), classifyStatementQuestions(sentence, kinds, candidates));
      const isDistinctiveChoice = noul(r, 'isDistinctiveChoice');
      return { sentence, kind: choice(r, 'kind'), attachTo: choice(r, 'attachTo'), isDistinctiveChoice, verdict: verdictOf(isDistinctiveChoice), provenance: r.provenance };
    }),
  );
