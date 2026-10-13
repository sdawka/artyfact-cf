import { hashOf } from "../canon.ts";
import { fakeAnswers } from "./fake.ts";
import type { AskOptions, S1Questions, S1Reply, SystemOne } from "./types.ts";

export type S1ErrorCode = "off" | "timeout" | "http" | "network" | "bad-response";

export class S1Error extends Error {
  readonly code: S1ErrorCode;
  readonly status?: number;
  constructor(message: string, code: S1ErrorCode, status?: number) {
    super(message);
    this.name = "S1Error";
    this.code = code;
    this.status = status;
  }
}

interface WireResponse { model?: string; answers: S1Reply["answers"]; usage?: S1Reply["usage"] }

const ZERO = { input_tokens: 0, output_tokens: 0 };

export const cacheKeyFor = (state: unknown, questions: S1Questions, model: string): string => hashOf({ state, questions, model });

/** Strips the fake provider's `benign` hint before a question goes on the wire. */
export const wireQuestions = (questions: S1Questions): S1Questions =>
  Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const { benign: _benign, ...wire } = q;
    return [id, wire as S1Questions[string]];
  }));

export const fakeSystemOne = (model = "fake"): SystemOne => ({
  mode: "fake",
  model,
  ask: async (state, questions) => ({ answers: fakeAnswers(state, questions), model, ms: 0, usage: ZERO, provider: "fake" }),
});

export const offSystemOne = (): SystemOne => ({
  mode: "off",
  model: "off",
  ask: async () => { throw new S1Error("System One is off", "off"); },
});

export interface HttpOptions {
  url: string;
  model: string;
  apiKey?: string;
  /** Name recorded as the reply's provider. */
  provider?: string;
  fetch?: typeof fetch;
  cacheSize?: number;
}

/** POSTs `{state, model, questions}` and expects `{model, answers, usage}`; retries timeouts, 429 and 529; LRU-caches replies. */
export function httpSystemOne(o: HttpOptions): SystemOne {
  const cache = new Map<string, S1Reply>();
  const cacheSize = o.cacheSize ?? 200;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function attempt(state: unknown, questions: S1Questions, timeoutMs: number): Promise<WireResponse> {
    const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(o.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(o.apiKey && { Authorization: `Bearer ${o.apiKey}` }) },
        body: JSON.stringify({ state, model: o.model, questions: wireQuestions(questions) }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new S1Error(`System One HTTP ${res.status}`, "http", res.status);
      const body = (await res.json()) as WireResponse;
      if (!body || typeof body.answers !== "object" || body.answers === null || Array.isArray(body.answers)) {
        throw new S1Error("System One: malformed response", "bad-response");
      }
      return body;
    } catch (e) {
      if (e instanceof S1Error) throw e;
      if (ctl.signal.aborted) throw new S1Error(`System One timed out after ${timeoutMs} ms`, "timeout");
      throw new S1Error(`System One network error: ${(e as Error)?.message ?? e}`, "network");
    } finally {
      clearTimeout(timer);
    }
  }

  const retryable = (e: S1Error) => e.code === "timeout" || (e.code === "http" && (e.status === 429 || e.status === 529));

  async function ask(state: unknown, questions: S1Questions, opts: AskOptions = {}): Promise<S1Reply> {
    const t0 = Date.now();
    const key = opts.cacheKey ?? cacheKeyFor(state, questions, o.model);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    const { timeoutMs = 2500, retries = 1, backoffMs = 200 } = opts;
    for (let n = 0; ; n++) {
      try {
        const body = await attempt(state, questions, timeoutMs);
        const reply: S1Reply = { answers: body.answers, model: body.model ?? o.model, ms: Date.now() - t0, usage: body.usage ?? ZERO, provider: o.provider ?? "http" };
        cache.set(key, reply);
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
        return reply;
      } catch (e) {
        if (!(e instanceof S1Error) || !retryable(e) || n >= retries) throw e;
        await sleep(backoffMs);
      }
    }
  }

  return { mode: "http", model: o.model, ask };
}
