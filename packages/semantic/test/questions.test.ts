import { describe, expect, it } from 'vitest';
import { classifyStatementQuestions, interferenceQuestions, purposeMeasureQuestions, reviewDeltaQuestions, topologyQuestions } from '../src';
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
});
