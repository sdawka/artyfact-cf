import { describe, expect, it } from 'vitest';
import { createSystemOne } from '../src';

const key = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TYPESAFE_API_KEY;

describe.skipIf(!key)('live System One', () => {
  it('answers one noul with a probability', async () => {
    const s1 = createSystemOne({ TYPESAFE_API_KEY: key });
    const r = await s1.ask('The sky is blue.', { q: { type: 'noul', instructions: 'Is the statement about colour?', criteria: { true: 'It is about a colour.', false: 'It is not about a colour.' } } }, { timeoutMs: 10_000 });
    const a = r.answers.q;
    expect(a?.type).toBe('noul');
    const p = (a as { noul: number }).noul;
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
