import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_DECISIONS_URL } from '@artyfact/ontology';
import { S1Error, cacheKeyFor, createSystemOne, type Questions } from '../src';
import { jsonRes, mockFetch, okBody } from './helpers';

const state = { a: 1 };
const questions: Questions = {
  n: { type: 'noul', instructions: 'Is it?', criteria: { true: 'yes', false: 'no' } },
  c: { type: 'choice', instructions: 'Which?', criteria: { x: 'ex', y: 'why' } },
  s: { type: 'score', instructions: 'How much?', criteria: ['low', 'high'] },
};
const answers = {
  n: { type: 'noul', noul: 0.8 },
  c: { type: 'choice', choice: 'x', probabilities: { x: 0.9, y: 0.1 }, confidence: 0.9 },
  s: { type: 'score', score: 1, probabilities: { '0': 0.1, '1': 0.9 }, confidence: 0.9, legend: [] },
};

describe('request shape', () => {
  it('typesafe: POST /v1/systemone with bearer, jev-latest, all three primitives', async () => {
    const f = mockFetch(() => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'tk', fetch: f });
    expect(s1).toMatchObject({ mode: 'http', model: 'jev-latest' });
    const reply = await s1.ask(state, questions);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tk');
    expect(JSON.parse(init!.body as string)).toMatchInlineSnapshot(`
      {
        "model": "jev-latest",
        "questions": {
          "c": {
            "criteria": {
              "x": "ex",
              "y": "why",
            },
            "instructions": "Which?",
            "type": "choice",
          },
          "n": {
            "criteria": {
              "false": "no",
              "true": "yes",
            },
            "instructions": "Is it?",
            "type": "noul",
          },
          "s": {
            "criteria": [
              "low",
              "high",
            ],
            "instructions": "How much?",
            "type": "score",
          },
        },
        "state": {
          "a": 1,
        },
      }
    `);
    expect(reply).toMatchObject({ provider: 'typesafe', model: 'jev-test', usage: { input_tokens: 10, output_tokens: 2 } });
    expect(reply.answers.n).toEqual(answers.n);
  });

  it('openrouter: the Decisions API with its own key; the typesafe key wins when both set', async () => {
    const f = mockFetch(() => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ OPENROUTER_API_KEY: 'ok', fetch: f });
    expect(s1).toMatchObject({ mode: 'http', model: DEFAULT_OPENROUTER_MODEL });
    await expect(s1.ask(state, questions)).resolves.toMatchObject({ provider: 'openrouter' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_DECISIONS_URL);
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer ok');
    await s1.ask({ other: 1 }, { n: { type: 'noul', instructions: 'Is it?', criteria: { true: 'yes', false: 'no' }, benign: 'no' } });
    expect(f.mock.calls[1]![1]!.body as string).not.toContain('benign');
    await createSystemOne({ TYPESAFE_API_KEY: 't', OPENROUTER_API_KEY: 'o', fetch: f }).ask(state, questions);
    expect(f.mock.calls[2]![0]).toBe('https://api.typesafe.ai/v1/systemone');
  });

  it('FAKE_S1=1 wins and never fetches; no keys is off', async () => {
    const f = vi.fn();
    const fake = createSystemOne({ TYPESAFE_API_KEY: 't', FAKE_S1: '1', fetch: f as never });
    expect(fake.mode).toBe('fake');
    expect((await fake.ask(state, questions)).provider).toBe('fake');
    const off = createSystemOne({ fetch: f as never });
    expect(off.mode).toBe('off');
    await expect(off.ask(state, questions)).rejects.toMatchObject({ name: 'S1Error', code: 'off' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('reliability', () => {
  it('timeout then timeout -> retries once, then S1Error', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const f = mockFetch(hang);
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    const err = await s1.ask(state, questions, { timeoutMs: 10, backoffMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(S1Error);
    expect(err.code).toBe('timeout');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('timeout then success -> one retry', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const f = mockFetch(hang, () => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    await expect(s1.ask(state, questions, { timeoutMs: 10, backoffMs: 1 })).resolves.toMatchObject({ provider: 'typesafe' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([429, 529])('%i then 200 -> success', async (status) => {
    const f = mockFetch(() => jsonRes({ error: 'busy' }, status), () => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    await expect(s1.ask(state, questions, { backoffMs: 1 })).resolves.toMatchObject({ model: 'jev-test' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([401, 422])('%i is not retried', async (status) => {
    const f = mockFetch(() => jsonRes({ error: 'no' }, status));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    await expect(s1.ask(state, questions, { backoffMs: 1 })).rejects.toMatchObject({ code: 'http', status });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('network failure and malformed body become S1Error', async () => {
    const net = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: mockFetch(() => Promise.reject(new TypeError('boom'))) });
    await expect(net.ask(state, questions)).rejects.toMatchObject({ code: 'network' });
    const bad = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: mockFetch(() => jsonRes({ nope: 1 })) });
    await expect(bad.ask(state, questions)).rejects.toMatchObject({ code: 'bad-response' });
  });
});

describe('cache', () => {
  it('second identical ask skips fetch; different state refetches', async () => {
    const f = mockFetch(() => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    await s1.ask(state, questions);
    await s1.ask({ a: 1 }, questions);
    expect(f).toHaveBeenCalledTimes(1);
    await s1.ask({ a: 2 }, questions);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('an explicit cacheKey scopes the cache but never replaces the state, and cacheKeyFor is stable', async () => {
    const f = mockFetch(() => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    await s1.ask({ x: 1 }, questions, { cacheKey: 'k1' });
    await s1.ask({ x: 1 }, questions, { cacheKey: 'k1' });
    expect(f).toHaveBeenCalledTimes(1);
    // Same scope, different state: a fresh ask, never the other state's answer.
    await s1.ask({ x: 2 }, questions, { cacheKey: 'k1' });
    expect(f).toHaveBeenCalledTimes(2);
    const k = await cacheKeyFor({ a: 1, b: 2 }, questions, 'm');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKeyFor({ b: 2, a: 1 }, questions, 'm')).toBe(k);
  });

  it('evicts beyond 200 entries (LRU)', async () => {
    const f = mockFetch(() => jsonRes(okBody(answers)));
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    for (let i = 0; i < 201; i++) await s1.ask({ i }, questions);
    expect(f).toHaveBeenCalledTimes(201);
    await s1.ask({ i: 200 }, questions);
    expect(f).toHaveBeenCalledTimes(201);
    await s1.ask({ i: 0 }, questions); // evicted
    expect(f).toHaveBeenCalledTimes(202);
  });
});
