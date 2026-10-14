import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import type { SystemAuthority } from '../worker/do/system-authority';
import { afterEach, describe, expect, it } from 'vitest';
import { lifecyclePaths, type RealizationPlan, type TaskStartResponse, type TaskSubmitResponse } from '../shared/lifecycle';
import { walkTree } from '../worker/artifacts/genome-source';
import { setArtifactsOverride } from '../worker/artifacts/client';
import { checkScreenshots, storeScreenshots } from '../worker/evidence';
import { resetHooks, setHooks } from '../worker/hooks';
import type { SubmissionContext } from '../worker/hooks/contract';
import { evidencePrefix } from '../worker/hooks/visual';
import { systemStub } from '../worker/service';
import { ADMIN, call, importFresh, passing } from './helpers/flows';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const png = (name = 'home.png') => ({ name, mediaType: 'image/png' as const, base64: b64(PNG) });
const path = (s: string, p: string, t: string, a: 'claim' | 'submit') => lifecyclePaths.action(s, p, t, a).replace(/^\/api/, '');
const definition = { id: 'ui', title: 'People UI', artifactId: 'artifact.webapp', steps: ['Update people UI'], dependsOn: [], readNodes: [], writeNodes: ['screen.people'], checks: ['C.people.list'] };

afterEach(() => { resetHooks(); setArtifactsOverride(undefined); });

describe('screenshot validation', () => {
  it('accepts real PNG, JPEG and WebP images of the declared type', () => {
    expect(checkScreenshots([png(), { name: 'm.jpg', mediaType: 'image/jpeg', base64: b64(JPEG) }])).toHaveLength(2);
  });

  it('refuses a type that does not match the bytes, non-images, too many, and oversized ones', () => {
    expect(() => checkScreenshots([{ name: 'x.jpg', mediaType: 'image/jpeg', base64: b64(PNG) }])).toThrow(/is image\/png, not image\/jpeg/);
    expect(() => checkScreenshots([{ name: 'x.png', mediaType: 'image/png', base64: btoa('GIF89a....') }])).toThrow(/not a PNG, JPEG or WebP/);
    expect(() => checkScreenshots([png(), png(), png(), png(), png()])).toThrow(/at most 4/);
    const big = new Uint8Array(4 * 1024 * 1024 + 1); big.set(PNG);
    let s = ''; for (let i = 0; i < big.length; i += 0x8000) s += String.fromCharCode(...big.subarray(i, i + 0x8000));
    expect(() => checkScreenshots([{ name: 'big.png', mediaType: 'image/png', base64: btoa(s) }])).toThrow(/limit is 4194304/);
  });

  it('stores under the attempt prefix and refuses without a bucket', async () => {
    const refs = await storeScreenshots(env.EVIDENCE, 'system.x', 'realization.1', 'c0ffee', [png()]);
    expect(refs[0]!.key.startsWith(evidencePrefix('system.x', 'realization.1', 'c0ffee'))).toBe(true);
    expect((await env.EVIDENCE.get(refs[0]!.key))?.httpMetadata?.contentType).toBe('image/png');
    await expect(storeScreenshots(undefined, 'system.x', 'realization.1', 'c0ffee', [png()])).rejects.toMatchObject({ status: 503, code: 'evidence-unavailable' });
    expect(await storeScreenshots(undefined, 'system.x', 'realization.1', 'c0ffee', [])).toEqual([]);
  });
});

describe('task submit with screenshots', () => {
  async function claimed() {
    const f = await importFresh();
    const p = (await call<RealizationPlan>('POST', lifecyclePaths.plans(f.systemId).replace(/^\/api/, ''), { title: 'Build', tasks: [definition] }, ADMIN)).json;
    const s = (await call<TaskStartResponse>('POST', path(f.systemId, p.id, 'ui', 'claim'), {}, ADMIN)).json;
    const repo = f.ns.repo(s.task.forkRepo), files = await walkTree(repo, s.task.base.commit);
    files.set('src/ui/people/index.html', '<h1>People</h1>');
    return { f, p, s, commit: repo.commit(files, 'UI') };
  }

  it('stores the screenshots, records them on the candidate and hands them to the hooks', async () => {
    const seen: SubmissionContext[] = [];
    // The visual check records the evidence prefix in provenance; the DO stores it as evaluations.evidence_key.
    setHooks({ runner: () => ({ ...passing, async runSubmission(ctx) {
      seen.push(ctx);
      return (await passing.runSubmission(ctx)).map((e) => ({ ...e, provenance: { ...e.provenance, evidenceKey: 'evidence/x/' } }));
    } }) });
    const { f, p, s, commit } = await claimed();
    const res = await call<TaskSubmitResponse>('POST', path(f.systemId, p.id, 'ui', 'submit'), { attemptId: s.attempt.id, generation: s.attempt.generation, commit, screenshots: [png('people.png')] }, { authorization: `Bearer ${s.secret}` });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const shots = seen[0]!.candidate.screenshots!;
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ name: 'people.png', mediaType: 'image/png', bytes: PNG.byteLength });
    expect(shots[0]!.key.startsWith(evidencePrefix(f.systemId, s.attempt.realizationId, commit))).toBe(true);
    expect((await systemStub(env, f.systemId).candidateManifest(res.json.candidate.id))?.screenshots).toEqual(shots);
    await runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (_i: SystemAuthority, state) => {
      const keys = state.storage.sql.exec('SELECT DISTINCT evidence_key FROM evaluations WHERE candidate_id = ?', res.json.candidate.id).toArray().map((r) => r.evidence_key);
      expect(keys).toEqual(['evidence/x/']);
    });
    const get = (sid: string) => exports.default.fetch(new Request(`http://example.com/api/systems/${sid}/evidence?key=${encodeURIComponent(shots[0]!.key)}`));
    const read = await get(f.systemId);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
    const other = await get('other');
    expect(other.status).toBe(404);
    await other.body?.cancel();
  });

  it('refuses invalid screenshots before recording anything, and callers without the attempt secret', async () => {
    setHooks({ runner: () => passing });
    const { f, p, s, commit } = await claimed();
    const submit = (screenshots: unknown, auth = s.secret) => call('POST', path(f.systemId, p.id, 'ui', 'submit'), { attemptId: s.attempt.id, generation: s.attempt.generation, commit, screenshots }, { authorization: `Bearer ${auth}` });
    expect((await submit([png(), png(), png(), png(), png()])).status).toBe(400);
    expect((await submit([{ ...png(), mediaType: 'image/gif' }])).status).toBe(400);
    expect((await submit([{ name: 'fake.png', mediaType: 'image/png', base64: btoa('not an image') }])).status).toBe(400);
    expect((await submit([png()], 'not-the-secret')).status).toBe(403);
    expect(await systemStub(env, f.systemId).candidates({})).toHaveLength(0);
    const listed = await env.EVIDENCE.list({ prefix: evidencePrefix(f.systemId, s.attempt.realizationId, commit) });
    expect(listed.objects).toHaveLength(0);
  });
});
