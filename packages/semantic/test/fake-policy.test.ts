import { describe, expect, it } from 'vitest';
import { band, choiceOutcome, createSystemOne, verdict, type Questions } from '../src';

const qs: Questions = {
  n: { type: 'noul', instructions: 'i', criteria: { true: 't', false: 'f' } },
  c: { type: 'choice', instructions: 'i', criteria: { a: 'A', b: 'B', none: 'N' } },
  s: { type: 'score', instructions: 'i', criteria: ['0', '1', '2'] },
};
const fake = createSystemOne({ FAKE_S1: '1' });
const ans = async (state: unknown) => (await fake.ask(state, qs)).answers;

describe('fake', () => {
  it('defaults: confident yes / first option / top score', async () => {
    const a = await ans({ t: 'plain' });
    expect(a.n).toEqual({ type: 'noul', noul: 0.95 });
    expect(a.c).toMatchObject({ choice: 'a', confidence: 0.95 });
    expect(a.s).toMatchObject({ score: 2 });
  });
  it('#s1no flips noul, picks none, scores 0', async () => {
    const a = await ans({ t: '#s1no' });
    expect(a.n).toEqual({ type: 'noul', noul: 0.05 });
    expect(a.c).toMatchObject({ choice: 'none' });
    expect(a.s).toMatchObject({ score: 0 });
  });
  it('#s1pick selects an offered key, ignores unknown ones', async () => {
    expect((await ans({ t: '#s1pick:b' })).c).toMatchObject({ choice: 'b' });
    expect((await ans({ t: '#s1pick:zzz' })).c).toMatchObject({ choice: 'a' });
  });
  it('#s1low gives low confidence', async () => {
    const a = await ans({ t: '#s1low' });
    expect(a.n).toEqual({ type: 'noul', noul: 0.55 });
    expect(a.c).toMatchObject({ confidence: 0.3 });
  });
});

describe('policy', () => {
  it('verdict boundaries are inclusive', () => {
    expect(verdict(0.9)).toBe('pass');
    expect(verdict(0.8999)).toBe('unknown');
    expect(verdict(0.1)).toBe('fail');
    expect(verdict(0.1001)).toBe('unknown');
    expect(verdict(0.5)).toBe('unknown');
    expect(verdict(null)).toBe('unknown');
    expect(verdict(0.7, { passAt: 0.7 })).toBe('pass');
    expect(verdict(0.3, { failAt: 0.3 })).toBe('fail');
  });
  it('band boundaries', () => {
    expect(band(0.9)).toBe('act');
    expect(band(0.8999)).toBe('review');
    expect(band(0.5)).toBe('review');
    expect(band(0.4999)).toBe('abstain');
  });
  it('choiceOutcome falls to unresolved under minConfidence', () => {
    expect(choiceOutcome({ choice: 'x', confidence: 0.5 })).toBe('x');
    expect(choiceOutcome({ choice: 'x', confidence: 0.4999 })).toBe('unresolved-interpretation');
    expect(choiceOutcome({ choice: 'x', confidence: 0.6 }, { minConfidence: 0.7 })).toBe('unresolved-interpretation');
  });
});
