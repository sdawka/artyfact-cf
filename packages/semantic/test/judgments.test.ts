import { describe, expect, it } from 'vitest';
import { classifyStatements, createSystemOne, interference, purposeMeasures, reviewDelta, topology } from '../src';
import { change, commitments, jsonRes, mockFetch, model, okBody } from './helpers';

const fake = createSystemOne({ FAKE_S1: '1' });
const withTag = (tag: string) => ({ ...change, after: `Send to a list ${tag}` });
const delta = (...tags: string[]) => ({ changes: tags.map((t, i) => ({ ...withTag(t), id: `ch${i}` })) });

describe('reviewDelta', () => {
  it('>=0.9 contradiction -> error + fail', async () => {
    const [r] = await reviewDelta(fake, model, delta(''), commitments);
    expect(r).toMatchObject({ id: 'ch0', level: 'error', verdict: 'fail' });
    expect(r!.contradicts).toEqual({ C1: 0.95, C2: 0.95 });
    expect(r!.provenance).toMatchObject({ provider: 'fake', model: 'jev-fake' });
  });
  it('0.55 band -> warning, never pass', async () => {
    const [r] = await reviewDelta(fake, model, delta('#s1low'), commitments);
    expect(r).toMatchObject({ level: 'warning', verdict: 'unknown' });
    expect(r!.changeClass!.outcome).toBe('unresolved-interpretation');
  });
  it('0.7 via mocked fetch -> warning', async () => {
    const f = mockFetch((init) => {
      const qs = JSON.parse(init.body as string).questions as Record<string, { type: string }>;
      const answers = Object.fromEntries(
        Object.entries(qs).map(([id, q]) => [
          id,
          q.type === 'noul'
            ? { type: 'noul', noul: id === 'contradicts.C1' ? 0.7 : 0.2 }
            : q.type === 'choice'
              ? { type: 'choice', choice: 'unresolved-interpretation', probabilities: { 'unresolved-interpretation': 0.8, 'hard-rule-violation': 0.1 }, confidence: 0.8 }
              : { type: 'score', score: 1, probabilities: {}, confidence: 0.8 },
        ]),
      );
      return jsonRes(okBody(answers));
    });
    const s1 = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f });
    const [r] = await reviewDelta(s1, model, delta(''), commitments);
    expect(r).toMatchObject({ level: 'warning', verdict: 'unknown' });
    expect(r!.provenance.provider).toBe('typesafe');
  });
  it('all signals low, clarification -> info + pass', async () => {
    const [r] = await reviewDelta(fake, model, delta('#s1no'), commitments);
    expect(r).toMatchObject({ level: 'info', verdict: 'pass', weakens: 0.05, touchesConsent: 0.05 });
    expect(r!.changeClass).toMatchObject({ choice: 'clarification', outcome: 'clarification' });
    expect(r!.specificity!.score).toBe(0);
  });
  it('hard-rule class at 0.95 with low contradicts -> error', async () => {
    const [r] = await reviewDelta(fake, model, delta('#s1no #s1pick:hard-rule-violation'), commitments);
    expect(r).toMatchObject({ level: 'error', verdict: 'fail' });
  });
  it('one result per change, in order', async () => {
    const rs = await reviewDelta(fake, model, delta('#s1no', '#s1low', ''), commitments);
    expect(rs.map((r) => r.level)).toEqual(['info', 'warning', 'error']);
  });
  it('provider off -> unknown/info, no fetch; failure -> provider error', async () => {
    const f = mockFetch(() => jsonRes({}));
    const off = createSystemOne({ fetch: f });
    const [r] = await reviewDelta(off, model, delta(''), commitments);
    expect(r).toMatchObject({ level: 'info', verdict: 'unknown', changeClass: null, contradicts: {} });
    expect(r!.provenance.provider).toBe('off');
    expect(f).not.toHaveBeenCalled();
    const broken = createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: mockFetch(() => jsonRes({}, 401)) });
    const [e] = await reviewDelta(broken, model, delta(''), commitments);
    expect(e).toMatchObject({ level: 'info', verdict: 'unknown' });
    expect(e!.provenance.provider).toBe('error');
  });
  it('provenance carries hashes, ms and usage', async () => {
    const [r] = await reviewDelta(fake, model, delta(''), commitments);
    expect(r!.provenance.questionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r!.provenance.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof r!.provenance.ms).toBe('number');
    expect(r!.provenance.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});

const node = (name: string) => ({ id: 'n1', kind: 'operation', name });
describe('topology', () => {
  it('maps verdicts from thresholds', async () => {
    const [yes] = await topology(fake, [{ node: node('Broadcast') }]);
    expect(yes).toMatchObject({ nodeId: 'n1', multiRecipient: 0.95, verdict: 'pass' });
    const [no] = await topology(fake, [{ node: node('Send #s1no') }]);
    expect(no).toMatchObject({ multiRecipient: 0.05, verdict: 'fail' });
    const [mid] = await topology(fake, [{ node: node('Send #s1low') }]);
    expect(mid!.verdict).toBe('unknown');
  });
  it('off -> unknown', async () => {
    const [r] = await topology(createSystemOne({}), [{ node: node('x') }]);
    expect(r).toMatchObject({ multiRecipient: null, verdict: 'unknown' });
    expect(r!.provenance.provider).toBe('off');
  });
});

describe('purposeMeasures', () => {
  const claim = { id: 'T1', mechanism: 'm', outcome: 'o', indicator: 'i' };
  it('fake default: engagement substitute -> fail; #s1no: not output? -> fail; never pass when unsure', async () => {
    const [a] = await purposeMeasures(fake, 'p', [claim]);
    expect(a!.verdict).toBe('fail');
    const [b] = await purposeMeasures(fake, 'p', [{ ...claim, outcome: '#s1low' }]);
    expect(b!.verdict).toBe('unknown');
  });
  it('pass needs low engagement, high outcome, measurable >=1 (mock)', async () => {
    const f = mockFetch(() =>
      jsonRes(okBody({
        engagementSubstitute: { type: 'noul', noul: 0.02 },
        outcomeNotOutput: { type: 'noul', noul: 0.97 },
        measurable: { type: 'score', score: 2, probabilities: {}, confidence: 0.9 },
      })),
    );
    const [r] = await purposeMeasures(createSystemOne({ TYPESAFE_API_KEY: 'k', fetch: f }), 'p', [claim]);
    expect(r!.verdict).toBe('pass');
  });
});

describe('interference', () => {
  const ev = { evolution: 'e', changedSubjects: ['s'], summary: 'x' };
  it('verdict from interferes', async () => {
    expect((await interference(fake, ev, ev, {})).verdict).toBe('pass');
    expect((await interference(fake, { ...ev, summary: '#s1no' }, ev, {})).verdict).toBe('fail');
    expect((await interference(createSystemOne({}), ev, ev, {})).verdict).toBe('unknown');
  });
});

describe('classifyStatements', () => {
  it('returns reviewable proposals with probabilities', async () => {
    const [p] = await classifyStatements(fake, ['Messages never expire. #s1pick:commitment'], [{ kind: 'journey' }], [{ id: 'n1', name: 'Inbox' }]);
    expect(p!.kind).toMatchObject({ choice: 'commitment', outcome: 'commitment' });
    expect(p!.kind!.probabilities.commitment).toBe(0.95);
    expect(p!.attachTo!.choice).toBe('n1');
    expect(p!.isDistinctiveChoice).toBe(0.95);
  });
  it('low confidence choice resolves to unresolved-interpretation', async () => {
    const [p] = await classifyStatements(fake, ['#s1low'], [], []);
    expect(p!.kind!.outcome).toBe('unresolved-interpretation');
  });
});
