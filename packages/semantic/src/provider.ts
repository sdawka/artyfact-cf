import { fakeAnswers } from './fake';
import { hashOf } from './hash';
import type { AskOptions, S1Mode, S1Reply, SystemOne, SystemOneResponse, Questions } from './types';

export type SystemOneEnv = {
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  FAKE_S1?: string;
  fetch?: typeof fetch;
};

export type S1ErrorCode = 'off' | 'timeout' | 'http' | 'network' | 'bad-response';

export class S1Error extends Error {
  constructor(
    message: string,
    readonly code: S1ErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'S1Error';
  }
}

const ENDPOINTS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: 'jev-1.13' },
} as const;

const CACHE_SIZE = 200;

/** Cache key; exported so a Worker can persist replies (KV/DO) under the same key. */
export const cacheKeyFor = (state: unknown, questions: Questions, model: string) =>
  hashOf({ state, questions, model });

/** The catalogue's `benign` hint is for the fake provider only; System One never sees it. */
export const wireQuestions = (questions: Questions): Questions =>
  Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const { benign: _benign, ...wire } = q;
    return [id, wire as Questions[string]];
  }));

export function createSystemOne(env: SystemOneEnv): SystemOne {
  const mode: S1Mode =
    env.FAKE_S1 === '1' ? 'fake' : env.TYPESAFE_API_KEY ? 'typesafe' : env.OPENROUTER_API_KEY ? 'openrouter' : 'off';
  const model = mode === 'typesafe' || mode === 'openrouter' ? ENDPOINTS[mode].model : mode === 'fake' ? 'jev-fake' : 'off';
  const cache = new Map<string, S1Reply>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function attempt(state: unknown, questions: Questions, timeoutMs: number): Promise<SystemOneResponse> {
    if (mode !== 'typesafe' && mode !== 'openrouter') throw new S1Error('System One is off', 'off');
    const key = mode === 'typesafe' ? env.TYPESAFE_API_KEY : env.OPENROUTER_API_KEY;
    const doFetch = env.fetch ?? globalThis.fetch.bind(globalThis);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(ENDPOINTS[mode].url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, model, questions: wireQuestions(questions) }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new S1Error(`System One HTTP ${res.status}`, 'http', res.status);
      const body = (await res.json()) as SystemOneResponse;
      if (!body || typeof body.answers !== 'object' || body.answers === null || Array.isArray(body.answers)) throw new S1Error('System One: malformed response', 'bad-response');
      return body;
    } catch (e) {
      if (e instanceof S1Error) throw e;
      if (ctl.signal.aborted) throw new S1Error(`System One timed out after ${timeoutMs} ms`, 'timeout');
      throw new S1Error(`System One network error: ${(e as Error)?.message ?? e}`, 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  const retryable = (e: S1Error) => e.code === 'timeout' || (e.code === 'http' && (e.status === 429 || e.status === 529));

  async function ask(state: unknown, questions: Questions, opts: AskOptions = {}): Promise<S1Reply> {
    const t0 = Date.now();
    if (mode === 'off') throw new S1Error('System One is off: set TYPESAFE_API_KEY, OPENROUTER_API_KEY or FAKE_S1=1', 'off');
    if (mode === 'fake') {
      return {
        answers: fakeAnswers(state, questions),
        model,
        ms: Date.now() - t0,
        usage: { input_tokens: 0, output_tokens: 0 },
        provider: 'fake',
      };
    }
    const key = opts.cacheKey ?? (await cacheKeyFor(state, questions, model));
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit); // LRU touch
      return hit;
    }
    const { timeoutMs = 2500, retries = 1, backoffMs = 200 } = opts;
    for (let n = 0; ; n++) {
      try {
        const body = await attempt(state, questions, timeoutMs);
        const reply: S1Reply = {
          answers: body.answers,
          model: body.model ?? model,
          ms: Date.now() - t0,
          usage: body.usage ?? { input_tokens: 0, output_tokens: 0 },
          provider: mode,
        };
        cache.set(key, reply);
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
        return reply;
      } catch (e) {
        if (!(e instanceof S1Error) || !retryable(e) || n >= retries) throw e;
        await sleep(backoffMs);
      }
    }
  }

  return { mode, model, ask };
}
