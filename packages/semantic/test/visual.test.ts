import { describe, expect, it } from 'vitest';
import { createSystemOne, createVisionSystemOne, visualCriterion, visualQuestions, visualState, type S1Image, type VisualSubject } from '../src';

const subject = (claim = 'The page reads clearly at desktop and mobile widths.'): VisualSubject => ({
  criterion: { id: 'C.site.model.compelling-visual-presentation', title: 'Compelling visual presentation', claim },
  subject: { id: 'component.model-explanation', kind: 'component', name: 'Ontology explanation' },
  page: { path: '/model', url: 'https://site.example.workers.dev/model' },
  images: [
    { source: 'platform', label: 'desktop 1280x800 capture of /model', sha256: 'aa' },
    { source: 'agent', label: 'agent screenshot model-mobile.png', sha256: 'bb' },
  ],
});
const img = (s: string): S1Image => ({ mediaType: 'image/png', base64: btoa(s) });

describe('visual questions', () => {
  it('state names the claim, the page and each image source in order', () => {
    const s = visualState(subject());
    expect(s.criterion.claim).toMatch(/reads clearly/);
    expect(s.images).toEqual([
      { position: 1, source: 'captured by the platform from the preview', label: 'desktop 1280x800 capture of /model', sha256: 'aa' },
      { position: 2, source: 'attached by the implementing agent', label: 'agent screenshot model-mobile.png', sha256: 'bb' },
    ]);
    const q = visualQuestions();
    expect(q.satisfies).toMatchObject({ type: 'noul' });
    expect(Object.keys((q.concern as { criteria: object }).criteria)).toContain('none');
  });
});

describe('visualCriterion', () => {
  it('sends the images with the ask and passes a confident yes', async () => {
    const seen: unknown[] = [];
    const s1 = { mode: 'http' as const, model: 'm', images: true, ask: async (_s: unknown, _q: unknown, o?: { images?: S1Image[] }) => {
      seen.push(o?.images);
      return { answers: { satisfies: { type: 'noul' as const, noul: 0.93 }, concern: { type: 'choice' as const, choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 } }, model: 'm', ms: 1, usage: { input_tokens: 1, output_tokens: 0 }, provider: 'clef' };
    } };
    const r = await visualCriterion(s1, subject(), [img('a'), img('b')]);
    expect(seen).toEqual([[img('a'), img('b')]]);
    expect(r).toMatchObject({ verdict: 'pass', satisfies: 0.93, images: 2, concern: { choice: 'none' }, provenance: { provider: 'clef' } });
  });

  it('fails a confident no and names the concern', async () => {
    const r = await visualCriterion(createSystemOne({ FAKE_S1: '1' }), subject('Broken #s1no #s1pick:broken-layout'), [img('a'), img('b')]);
    expect(r.verdict).toBe('fail');
    expect(r.concern?.choice).toBe('broken-layout');
  });

  it('a provider that cannot read images is unknown, never a pass', async () => {
    const never = (() => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
    const s1 = createVisionSystemOne({ TYPESAFE_API_KEY: 'k', fetch: never });
    const r = await visualCriterion(s1, subject(), [img('a'), img('b')]);
    expect(r.verdict).toBe('unknown');
    expect(r.provenance).toMatchObject({ provider: 'error', error: { code: 'unsupported' } });
  });

  it('no images is unknown without asking', async () => {
    let asked = false;
    const s1 = { ...createSystemOne({ FAKE_S1: '1' }), ask: async () => { asked = true; throw new Error('no'); } };
    const r = await visualCriterion(s1, { ...subject(), images: [] }, []);
    expect(asked).toBe(false);
    expect(r).toMatchObject({ verdict: 'unknown', provenance: { provider: 'none', error: { name: 'NoImages' } } });
  });

  it('refuses a label/image count mismatch', async () => {
    await expect(visualCriterion(createSystemOne({ FAKE_S1: '1' }), subject(), [img('a')])).rejects.toThrow(/label/);
  });
});
