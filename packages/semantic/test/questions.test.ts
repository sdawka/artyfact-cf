import { describe, expect, it } from 'vitest';
import { classifyStatementQuestions, fakeAnswers, interferenceQuestions, purposeMeasureQuestions, reviewDeltaQuestions, topologyQuestions, wireQuestions } from '../src';
import type { Questions } from '../src';
import { change, commitments, model } from './helpers';

describe('question catalogue (Appendix E)', () => {
  it('E.1: changeClass, weakens, specificity, touchesConsent, contradicts.<id> per commitment', () => {
    const q = reviewDeltaQuestions(change, commitments, model.governing);
    expect(Object.keys(q).sort()).toEqual(['changeClass', 'contradicts.C1', 'contradicts.C2', 'specificity', 'touchesConsent', 'weakens']);
    expect(Object.keys((q.changeClass as { criteria: object }).criteria)).toEqual([
      'deliberate-nonstandard-choice',
      'unresolved-interpretation',
      'hard-rule-violation',
      'clarification',
    ]);
    expect(q.specificity!.type).toBe('score');
    expect((q.specificity as { criteria: string[] }).criteria).toHaveLength(4);
    expect(JSON.stringify(q['contradicts.C1'])).toContain('No group threads.');
  });
  it('E.2/E.3/E.4 ids and primitives', () => {
    expect(Object.entries(topologyQuestions()).map(([k, v]) => [k, v.type])).toEqual([['multiRecipient', 'noul'], ['isPublication', 'noul']]);
    expect(Object.entries(purposeMeasureQuestions()).map(([k, v]) => [k, v.type])).toEqual([
      ['engagementSubstitute', 'noul'],
      ['outcomeNotOutput', 'noul'],
      ['measurable', 'score'],
    ]);
    expect((purposeMeasureQuestions().measurable as { criteria: string[] }).criteria).toHaveLength(3);
    expect(Object.entries(interferenceQuestions()).map(([k, v]) => [k, v.type])).toEqual([['interferes', 'noul'], ['needsComposition', 'noul']]);
  });
  it('E.5: kind and attachTo carry no-match options; descriptions <=255', () => {
    const q = classifyStatementQuestions('s', [{ kind: 'journey' }, { kind: 'role' }], [{ id: 'n1', name: 'Inbox', description: 'x'.repeat(400) }]);
    const kind = (q.kind as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(kind)).toEqual(['journey', 'role', 'commitment', 'hypothesis', 'none']);
    const attach = (q.attachTo as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(attach)).toEqual(['n1', 'new']);
    for (const d of [...Object.values(kind), ...Object.values(attach)]) expect(d.length).toBeLessThanOrEqual(255);
    expect(q.isDistinctiveChoice!.type).toBe('noul');
  });
  it('every catalogue question declares a valid benign answer, and only the fake reads it', () => {
    const all: [string, Questions][] = [
      ['reviewDelta', reviewDeltaQuestions(change, commitments, model.governing)],
      ['topology', topologyQuestions()],
      ['purposeMeasure', purposeMeasureQuestions()],
      ['interference', interferenceQuestions()],
      ['classifyStatement', classifyStatementQuestions('s', [{ kind: 'journey' }], [{ id: 'n1' }])],
    ];
    for (const [builder, qs] of all) {
      for (const [id, q] of Object.entries(qs)) {
        const at = `${builder}.${id}`;
        if (q.type === 'noul') expect(['yes', 'no'], at).toContain(q.benign);
        else if (q.type === 'choice') expect(Object.keys(q.criteria), at).toContain(q.benign);
        else expect(q.benign !== undefined && q.benign >= 0 && q.benign < q.criteria.length, at).toBe(true);
      }
      // The fake answers exactly the declared benign answer.
      const answers = fakeAnswers({}, qs);
      for (const [id, q] of Object.entries(qs)) {
        const a = answers[id]!;
        if (q.type === 'noul' && a.type === 'noul') expect(a.noul > 0.5 ? 'yes' : 'no', `${builder}.${id}`).toBe(q.benign);
        if (q.type === 'choice' && a.type === 'choice') expect(a.choice).toBe(q.benign);
        if (q.type === 'score' && a.type === 'score') expect(a.score).toBe(q.benign);
      }
      expect(JSON.stringify(wireQuestions(qs))).not.toContain('benign');
    }
  });
});
