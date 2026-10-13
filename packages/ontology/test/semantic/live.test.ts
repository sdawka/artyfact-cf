import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS, DEFAULT_THRESHOLDS, evaluateAndJudge, explainerFromEnv, pairOf, policyEntry, providerFromEnv, readAnswer,
  type Answer, type Explainer, type Explanation, type ExplainRequest, type Finding, type Graph, type JudgmentStep, type SystemOne, type Template,
} from "../../src/index.ts";
import { defectMatches, defectRelated, FIXTURES, subjectsOf, subjectsOfPlanted, VOCABULARIES, type Planted, type Vocabulary } from "./vocabularies.ts";

/**
 * Real-provider semantic suite on the v2 funnel. Skipped unless OPENROUTER_API_KEY is set. The provider comes from
 * `providerFromEnv` (OPENROUTER_MODEL picks the decision model) and the explainer from `explainerFromEnv`
 * (OPENROUTER_EXPLAIN_MODEL; EXPLAIN=0 turns it off); the key is handed to them only.
 * Run: OPENROUTER_API_KEY=… npm run test:live -w @artyfact/ontology
 */
// Opt-in only, so `npm test` never calls a paid API just because a key is in the environment.
const KEY = process.env.ONTOLOGY_LIVE === "1" ? process.env.OPENROUTER_API_KEY?.trim() : undefined;
const ASK = { timeoutMs: 60_000, retries: 2, backoffMs: 2_000 };
const slug = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "-");

type Question = Template["questions"][number];

interface LiveAnswer {
  fixture: string;
  /** Provider call number within the run; questions sharing a call share it. */
  call: number;
  question: string;
  subject: string;
  text: string;
  batchSize: number;
  answer?: Answer;
  /** The answer as a policy key (`yes`, `no`, a choice, a score). */
  key?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  /** Funnel round and stage of the call; `companion` when the question rode along and settled no finding of its own. */
  round?: number;
  stage?: string;
  companion?: boolean;
  defect?: string;
  bandedConfidence?: number;
  /** Length of the longest finding path this answer is a step of. */
  pathLength?: number;
  latencyMs?: number;
  model?: string;
  inputTokens?: number;
  error?: string;
}

interface LiveExplanation extends ExplainRequest, Explanation { fixture: string }

const answers: LiveAnswer[] = [];
const explanations: LiveExplanation[] = [];
const verdicts: Record<string, unknown> = {};
const detected: Record<string, { confident: number; review: number; missed: number }> = {};
const startedAt = new Date().toISOString();
let calls = 0;

/** Delegates to `inner` and records every question of every call, so a run can be audited without re-asking. */
function recording(inner: SystemOne, fixture: string): SystemOne {
  return {
    ...inner,
    async ask(state, questions, opts) {
      const call = ++calls;
      const s = state as { subject?: { id: string }; counterpart?: { id: string }; candidate?: { text: string } };
      const subject = [s.subject?.id, s.counterpart?.id].filter(Boolean).join("|");
      const text = s.candidate?.text ?? "";
      const batchSize = Object.keys(questions).length;
      try {
        const reply = await inner.ask(state, questions, opts);
        for (const id of Object.keys(questions)) {
          answers.push({
            fixture, call, question: id, subject, text, batchSize, answer: reply.answers[id],
            latencyMs: reply.ms, model: reply.model, inputTokens: reply.usage.input_tokens,
          });
        }
        return reply;
      } catch (e) {
        for (const id of Object.keys(questions)) answers.push({ fixture, call, question: id, subject, text, batchSize, error: (e as Error).message });
        throw e;
      }
    },
  };
}

function recordingExplainer(inner: Explainer, fixture: string): Explainer {
  return {
    ...inner,
    async explain(state, req, opts) {
      const e = await inner.explain(state, req, opts);
      explanations.push({ fixture, ...req, ...e });
      return e;
    },
  };
}

/** Questions by id, and whether an answer to one is harmful (its policy entry does not pass) for the subject's kind. */
function policyReader(template: Template, graph: Graph) {
  const questions = new Map(template.questions.map((q) => [q.id, q]));
  const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const kindOf = (subject: string) => kinds.get((pairOf(subject, (id) => kinds.has(id)) ?? [subject])[0]);
  const harmful = (question: string, answer: string | undefined, subject: string) => {
    const q = questions.get(question);
    if (!q || answer === undefined) return false;
    return (policyEntry(q, answer, kindOf(subject))?.level ?? "pass") !== "pass";
  };
  return { questions, kindOf, harmful };
}

/** How a path step was reached: entry (or terms, or a companion settled on its own), a `self` refinement, or the walk that opened a new finding. */
function stageOf(path: JudgmentStep[], i: number, settled?: string): string {
  if (i === 0) return settled === "companion" && path.length === 1 ? "companion" : path[0]!.question === "term.usage" ? "terms" : "entry";
  const prev = path[i - 1]!;
  if (path[i]!.subject === prev.subject) return "self";
  if (prev.question === "set.member") return "pairs";
  if (prev.question === "sections.other") return "sections";
  return "follow-up";
}

/** Adds round, stage, defect, banded confidence and path length to the fixture's recorded answers, from the findings' paths. */
function annotate(fixture: string, findings: Finding[], reader: ReturnType<typeof policyReader>) {
  const steps = new Map<string, { round: number; stage: string; step: JudgmentStep; pathLength: number }>();
  for (const f of findings) {
    const path = f.judgment?.path ?? [];
    path.forEach((step, i) => {
      const key = `${step.question} ${step.subject}`;
      const had = steps.get(key);
      if (!had) steps.set(key, { round: i + 1, stage: stageOf(path, i, f.provenance?.stage), step, pathLength: path.length });
      else had.pathLength = Math.max(had.pathLength, path.length);
    });
  }
  const mine = answers.filter((a) => a.fixture === fixture);
  for (const a of mine) {
    const q = reader.questions.get(a.question);
    const r = q ? readAnswer(q, a.answer) : undefined;
    if (r) Object.assign(a, { key: r.answer, probabilities: r.probabilities, confidence: r.confidence });
    const hit = steps.get(`${a.question} ${a.subject}`);
    if (hit) {
      Object.assign(a, {
        round: hit.round, stage: hit.stage, pathLength: hit.pathLength,
        ...(hit.step.defect !== undefined && { defect: hit.step.defect }),
        ...(hit.step.bandedConfidence !== undefined && { bandedConfidence: hit.step.bandedConfidence }),
      });
    } else if (q && r) {
      const defect = policyEntry(q, r.answer, reader.kindOf(a.subject))?.defect;
      if (defect !== undefined) a.defect = defect;
    }
  }
  // Companions (and questions of calls that settled nothing) take their round from a call-mate that is on a path.
  for (const a of mine) {
    if (a.round !== undefined) continue;
    const mate = mine.find((b) => b.call === a.call && b.round !== undefined);
    if (mate) Object.assign(a, { round: mate.round, stage: mate.stage, companion: true });
  }
}

const brief = (f: Finding) => ({
  rule: f.rule, subject: f.subject, level: f.level, status: f.judgment?.status, answer: f.judgment?.answer, confidence: f.judgment?.confidence,
  bandedConfidence: f.judgment?.bandedConfidence, defect: f.judgment?.defect, narrowedBy: f.judgment?.narrowedBy,
  path: f.judgment?.path?.map((s) => `${s.question}=${s.answer ?? "?"}`), error: f.provenance?.error?.message,
});

type Detection = { via: "finding" | "entry"; status: "confident" | "review"; found: unknown } | null;

/**
 * A planted item is detected `confident` when a finding on its subject(s) carries the planted defect (prefix match) at
 * the planted level; `review` when a finding on its subject(s), or on its `entry`, is in review and either has a
 * harmful answer on the planted rule or on any step of its path, or carries a defect on the planted defect's branch
 * (an ancestor such as the question's family, the defect itself, or one under it).
 */
function detect(p: Planted, semantic: Finding[], fixture: string, reader: ReturnType<typeof policyReader>, all: Finding[] = semantic): Detection {
  const subjects = subjectsOfPlanted(p);
  // A pattern check needs no judgment: its own finding at the planted level is the detection.
  if (p.check?.deterministic) {
    const hit = all.find((f) => f.rule === p.rule && subjects.includes(f.subject ?? "") && f.level === p.level);
    return hit ? { via: "finding", status: "confident", found: brief(hit) } : null;
  }
  // A judged check counts only through its own question, so another plant on the same node cannot stand in for it.
  const onSubject = semantic.filter((f) => subjects.includes(f.subject ?? "") && (!p.check || f.rule === `semantic:${p.rule}`));
  const hit = onSubject.find((f) => f.judgment?.status === "confident" && f.level === p.level && defectMatches(f.judgment.defect, p.defect));
  if (hit) return { via: "finding", status: "confident", found: brief(hit) };

  const inReview = (f: Finding) => f.judgment?.status === "review" || f.level === "review";
  const harmfulOn = (f: Finding) => {
    const j = f.judgment!;
    if (f.rule === `semantic:${p.rule}` && reader.harmful(j.question, j.answer, f.subject ?? "")) return true;
    return (j.path ?? []).some((s) => reader.harmful(s.question, s.answer, s.subject));
  };
  // In review the funnel stops at the question's family defect, so an ancestor of the planted defect counts too.
  const flagged = (f: Finding) => inReview(f) && (harmfulOn(f) || defectRelated(f.judgment?.defect, p.defect));
  const review = onSubject.find(flagged);
  if (review) return { via: "finding", status: "review", found: brief(review) };
  if (p.entry) {
    const entry = semantic.find((f) => f.rule === `semantic:${p.entry!.rule}` && f.subject === p.entry!.subject && flagged(f));
    if (entry) return { via: "entry", status: "review", found: brief(entry) };
  }

  return null;
}

if (!KEY) console.info("live semantic suite skipped: set ONTOLOGY_LIVE=1 and OPENROUTER_API_KEY to run it");

describe.skipIf(!KEY)("live semantic suite (v2 funnel)", () => {
  // Measures the OpenRouter decider: a TypeSafe key in the environment must not take its place.
  const provider = providerFromEnv({ ...process.env, TYPESAFE_API_KEY: undefined });
  const explainer = explainerFromEnv(process.env);

  afterAll(() => {
    const file = join(FIXTURES, `live-results.v2.${slug(provider.model)}.json`);
    const out = {
      model: provider.model, explainModel: explainer.model, startedAt, finishedAt: new Date().toISOString(),
      thresholds: DEFAULT_THRESHOLDS, limits: DEFAULT_LIMITS, ask: ASK, calls, verdicts, detected, answers, explanations,
    };
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  });

  for (const make of VOCABULARIES) {
    const v: Vocabulary = make();
    it(`${v.name}: finds every planted problem and leaves the controls alone`, async () => {
      const s1 = recording(provider, v.name);
      const r = await evaluateAndJudge(v.template, v.graph, s1, { ask: ASK, explainer: recordingExplainer(explainer, v.name) });
      const semantic = r.findings.filter((f) => f.rule.startsWith("semantic:"));
      const reader = policyReader(v.template, v.graph);
      annotate(v.name, semantic, reader);

      const planted = v.expectations.planted.map((p) => {
        const d = detect(p, semantic, v.name, reader, r.findings);
        return { id: p.id, rule: p.rule, subjects: subjectsOfPlanted(p), defect: p.defect, expected: p.level, detected: d?.status ?? "missed", via: d?.via, found: d?.found ?? null };
      });
      const controls = v.expectations.controls.map((c) => {
        const about = semantic.filter((f) => subjectsOf(f.subject).includes(c.subject));
        const flagged = about.filter((f) => f.level === "error" || f.level === "warning").map(brief);
        const review = about.filter((f) => f.level === "review" || f.judgment?.status === "review").map(brief);
        return { id: c.id, subject: c.subject, ok: flagged.length === 0, flagged, review };
      });
      const tally = {
        confident: planted.filter((p) => p.detected === "confident").length,
        review: planted.filter((p) => p.detected === "review").length,
        missed: planted.filter((p) => p.detected === "missed").length,
      };
      detected[v.name] = tally;
      verdicts[v.name] = {
        calls: r.judgments.calls, envelope: v.expectations.calls, providerCalls: new Set(answers.filter((a) => a.fixture === v.name).map((a) => a.call)).size,
        rounds: r.judgments.rounds, gated: r.judgments.gated, budget: r.judgments.budget, explained: r.judgments.explained,
        judgments: r.judgments, detected: tally, planted, controls,
      };

      for (const p of planted) expect.soft(p.detected, `${p.id}: no ${p.defect} finding on ${p.subjects.join(" or ")}`).not.toBe("missed");
      for (const c of controls) expect.soft(c.flagged, `${c.id}: control flagged`).toEqual([]);
      expect.soft(r.judgments.calls, `${v.name}: calls within the envelope`).toBeLessThanOrEqual(v.expectations.calls);
      expect(tally.missed, `${v.name}: planted problems missed`).toBe(0);
    }, 20 * 60_000);
  }
});
