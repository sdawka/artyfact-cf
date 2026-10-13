import { failWith, limiter, lruCache, openRouterHeaders, postJson, redactor, withRetries } from "./http.ts";
import { cacheKeyFor, fakeSystemOne, offSystemOne, S1Error, typeSafeProvider, wireQuestions } from "./provider.ts";
import type { Answer, AskOptions, S1Questions, S1Reply, SystemOne } from "./types.ts";

/** OpenRouter Decisions API ("System One" decision models). */
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_OPENROUTER_MODEL = "perplexity/pplx-decider-v1.1-27b";

export interface OpenRouterOptions {
  apiKey: string;
  /** A model that outputs decisions; default `perplexity/pplx-decider-v1.1-27b`. */
  model?: string;
  url?: string;
  fetch?: typeof fetch;
  cacheSize?: number;
  /** Requests in flight at once; `judge` asks every candidate concurrently. Default 4. */
  concurrency?: number;
  /** Sent as `X-Title`. */
  title?: string;
}

interface DecisionsBody {
  id?: string;
  model?: string;
  provider?: string;
  answers?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
  error?: { code?: number | string; message?: string };
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const probs = (x: unknown): x is Record<string, number> =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every(num);

/**
 * One wire answer as the engine's `Answer`, or undefined when it does not fit the question's primitive.
 * A `score` comes back as an expected value over levels; the engine's policy keys are level indices, so the score
 * becomes the most probable level and its confidence the reported confidence (else that level's probability).
 */
export function readDecision(type: S1Questions[string]["type"], raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  if (type === "noul") return num(a.noul) && a.noul >= 0 && a.noul <= 1 ? { type: "noul", noul: a.noul } : undefined;
  if (!probs(a.probabilities)) return undefined;
  const p = a.probabilities;
  if (type === "choice") {
    if (typeof a.choice !== "string") return undefined;
    const confidence = num(a.confidence) ? a.confidence : p[a.choice];
    return num(confidence) ? { type: "choice", choice: a.choice, probabilities: p, confidence } : undefined;
  }
  const levels = Object.keys(p).filter((k) => /^\d+$/.test(k)).sort((x, y) => p[y] - p[x] || Number(x) - Number(y));
  if (!levels.length) return undefined;
  const score = Number(levels[0]);
  const confidence = num(a.confidence) ? a.confidence : p[levels[0]];
  return { type: "score", score, probabilities: p, confidence, ...(a.legend !== undefined && { legend: a.legend }) };
}

/**
 * The OpenRouter Decisions API as a `SystemOne`. Engine question types map to the API primitives one to one:
 * yes-no is `noul`, choice is `choice`, score is `score`. Timeouts, 429 and 5xx are retried; every failure is an
 * `S1Error`, which `judge` turns into an unknown judgment. The key lives only in this closure: it is never logged,
 * never part of a reply, and redacted from any error message.
 */
export function openRouterProvider(o: OpenRouterOptions): SystemOne {
  if (!o.apiKey) throw new S1Error("OpenRouter needs an API key", "off");
  const key = o.apiKey;
  const model = o.model || DEFAULT_OPENROUTER_MODEL;
  const url = o.url ?? OPENROUTER_DECISIONS_URL;
  const cache = lruCache<S1Reply>(o.cacheSize ?? 200);
  const run = limiter(o.concurrency ?? 4);
  const redact = redactor(key);
  const fail = failWith(redact);

  const attempt = (state: unknown, questions: S1Questions, timeoutMs: number): Promise<Omit<S1Reply, "ms">> =>
    postJson<DecisionsBody, Omit<S1Reply, "ms">>({
      url, fetch: o.fetch, timeoutMs, label: "OpenRouter", redact,
      headers: openRouterHeaders(key, o.title),
      body: { model, state, questions: wireQuestions(questions) },
    }, ({ res, body }) => {
      if (!res.ok || body?.error) {
        const status = res.ok ? Number(body?.error?.code) || 502 : res.status;
        throw fail(`OpenRouter HTTP ${status}${body?.error?.message ? `: ${body.error.message}` : ""}`, "http", status);
      }
      if (!body || !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) throw fail("OpenRouter: malformed response", "bad-response");
      const raw = body.answers as Record<string, unknown>;
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(questions)) {
        const a = readDecision(q.type, raw[id]);
        if (!a) throw fail(`OpenRouter: malformed ${q.type} answer for ${id}`, "bad-response");
        answers[id] = a;
      }
      const usage = { input_tokens: num(body.usage?.input_tokens) ? body.usage.input_tokens : 0, output_tokens: num(body.usage?.output_tokens) ? body.usage.output_tokens : 0 };
      return { answers, model: typeof body.model === "string" ? body.model : model, usage, provider: "openrouter" };
    });

  async function ask(state: unknown, questions: S1Questions, opts: AskOptions = {}): Promise<S1Reply> {
    const cacheKey = opts.cacheKey ?? cacheKeyFor(state, questions, model);
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const { timeoutMs = 2500, retries = 3, backoffMs = 250 } = opts;
    return run(async () => {
      const t0 = Date.now();
      const reply: S1Reply = { ...(await withRetries(() => attempt(state, questions, timeoutMs), { retries, backoffMs })), ms: Date.now() - t0 };
      cache.set(cacheKey, reply);
      return reply;
    });
  }

  return { mode: "http", model, ask };
}

export interface ProviderEnv {
  FAKE_S1?: string;
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  fetch?: typeof fetch;
}

/**
 * artyfact's precedence: `FAKE_S1=1` wins, then `TYPESAFE_API_KEY`, then `OPENROUTER_API_KEY` (model from
 * `OPENROUTER_MODEL`), else off.
 */
export function providerFromEnv(env: ProviderEnv): SystemOne {
  if (env.FAKE_S1 === "1") return fakeSystemOne();
  const typeSafeKey = env.TYPESAFE_API_KEY?.trim();
  if (typeSafeKey) return typeSafeProvider({ apiKey: typeSafeKey, fetch: env.fetch });
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (apiKey) return openRouterProvider({ apiKey, model: env.OPENROUTER_MODEL?.trim() || undefined, fetch: env.fetch });
  return offSystemOne();
}
