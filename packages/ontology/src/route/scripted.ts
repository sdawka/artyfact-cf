import { fakeAnswer } from "../judge/fake.ts";
import type { Answer, S1Question, S1Questions, SystemOne } from "../judge/types.ts";

/** A scripted answer key, or a function of the state and question returning one (undefined falls back to the fake). */
export type ScriptedAnswer = string | ((state: unknown, question: S1Question, id: string) => string | undefined);

const ZERO = { input_tokens: 0, output_tokens: 0 };

/** A confident answer for `key`: `yes`/`no` for a yes-no question, an option key for a choice, a level for a score. */
export function answerFor(q: S1Question, key: string, confidence = 0.95): Answer {
  if (q.type === "noul") return { type: "noul", noul: key === "yes" ? confidence : 1 - confidence };
  const labels = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
  const rest = (1 - confidence) / Math.max(1, labels.length - 1);
  const probabilities = Object.fromEntries(labels.map((l) => [l, l === key ? confidence : rest]));
  return q.type === "choice"
    ? { type: "choice", choice: key, confidence, probabilities }
    : { type: "score", score: Number(key), confidence, probabilities };
}

/**
 * A System One that answers by question id from `answers`, confidently; unscripted questions get the fake provider's
 * answer (directives in the state apply). Drives the routing chain deterministically in tests and the gold oracle.
 */
export function scriptedSystemOne(answers: Record<string, ScriptedAnswer>, model = "scripted"): SystemOne {
  return {
    mode: "fake",
    model,
    ask: async (state, questions: S1Questions) => {
      const flat = JSON.stringify(state ?? "");
      const out = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
        const a = answers[id];
        const key = typeof a === "function" ? a(state, q, id) : a;
        return [id, key === undefined ? fakeAnswer(q, flat, id) : answerFor(q, key)];
      }));
      return { answers: out, model, ms: 0, usage: ZERO, provider: "scripted" };
    },
  };
}
