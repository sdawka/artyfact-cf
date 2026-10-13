import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { FileCompare, ImportSystemResponse } from '../shared/api';
import type { ImplementationReview, RealizationPlan, TaskStartResponse, TaskSubmitResponse } from '../shared/lifecycle';
import type { SystemAuthority } from '../worker/do/system-authority';
import { walkTree } from '../worker/artifacts/genome-source';
import { setArtifactsOverride } from '../worker/artifacts/client';
import { setEditorTransport } from '../worker/editor';
import { resetHooks, setHooks } from '../worker/hooks';
import { systemStub } from '../worker/service';
import { appFiles, genomeFor } from './fixtures/genome';
import { ADMIN, call, genomeAmendment, importFresh, passing, renameContactAndScreen, type Flow } from './helpers/flows';
import { FakeArtifacts } from './helpers/fake-artifacts';
import { fakeReceivePack } from './helpers/fake-receive-pack';

beforeEach(() => setHooks({ runner: () => passing }));
afterEach(() => { resetHooks(); setArtifactsOverride(undefined); setEditorTransport(undefined); });
const root = (f: Flow, plan?: string) => `/systems/${f.systemId}/realization-plans${plan ? `/${plan}` : ''}`;
const task = (id = 'ui', artifactId = 'artifact.webapp') => ({ id, title: id, artifactId, steps: ['Update People'], dependsOn: [], readNodes: [], writeNodes: ['screen.people'], checks: ['C.people.list'] });

async function planFor(f: Flow, tasks = [task()]) {
  setEditorTransport({ fetch: fakeReceivePack(f.ns).fetch });
  const response = await call<RealizationPlan>('POST', root(f), { title: 'Realize accepted shape', tasks }, ADMIN);
  expect(response.status, JSON.stringify(response.json)).toBe(201);
  return response.json;
}

async function submitAndSelect(f: Flow, plan: RealizationPlan, id: string) {
  const path = `${root(f, plan.id)}/tasks/${id}`;
  const started = await call<TaskStartResponse>('POST', `${path}/claim`, {}, ADMIN);
  expect(started.status, JSON.stringify(started.json)).toBe(201);
  const { task: current, attempt, secret } = started.json;
  const repo = f.ns.repo(current.forkRepo), files = await walkTree(repo, current.base.commit);
  files.set('src/ui/people/index.html', `<h1>${id} implemented</h1>`);
  const commit = repo.commit(files, id);
  const submitted = await call<TaskSubmitResponse>('POST', `${path}/submit`, { attemptId: attempt.id, generation: attempt.generation, commit }, { authorization: `Bearer ${secret}` });
  expect(submitted.status, JSON.stringify(submitted.json)).toBe(201);
  const selected = await call('POST', `${path}/select`, { candidateId: submitted.json.candidate.id }, ADMIN);
  expect(selected.status, JSON.stringify(selected.json)).toBe(200);
  return { ...started.json, candidate: submitted.json.candidate };
}

async function integrate(f: Flow, p: RealizationPlan) {
  const response = await call<ImplementationReview>('POST', `${root(f, p.id)}/integrate`, {}, ADMIN);
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  return response.json;
}

it('reviews and promotes two artifact bindings atomically with exact candidates', async () => {
  const systemId = `system.atomic${crypto.randomUUID().slice(0, 8)}`;
  const ns = new FakeArtifacts(), genomeRepo = `g-${systemId}`, appRepo = `a-${systemId}`, secondRepo = `b-${systemId}`;
  const files = genomeFor(systemId), thing = parse(files['thing.webapp/node.yaml']);
  thing.fields.artifacts.push({ artifact: 'artifact.secondary', type: 'worker-fullstack', repo: secondRepo, scope: [] });
  files['thing.webapp/node.yaml'] = stringify(thing);
  ns.create(genomeRepo).commit(files, 'Genome'); ns.create(appRepo).commit(appFiles, 'Primary'); ns.create(secondRepo).commit(appFiles, 'Secondary');
  setArtifactsOverride(ns);
  const imported = await call<ImportSystemResponse>('POST', '/systems/import', { systemId, genomeRepo, appRepo }, ADMIN);
  expect(imported.status, JSON.stringify(imported.json)).toBe(201);
  const f: Flow = { ns, systemId, genomeRepo, appRepo, imp: imported.json, forks: 0 };
  const p = await planFor(f, [task('first'), task('second', 'artifact.secondary')]);
  await submitAndSelect(f, p, 'first'); await submitAndSelect(f, p, 'second');
  const review = await integrate(f, p), stub = systemStub(env, systemId), before = await stub.state();
  // Task and integration candidates are reviewed in Work, never in the legacy Evolution inbox.
  expect((await stub.summary())!.realizationCounts).toMatchObject({ pending: 0, awaitingAdmin: 0, awaitingReview: 0 });
  expect(review.bindings.map(b => b.artifactId).sort()).toEqual(['artifact.secondary', 'artifact.webapp']);
  const file = await call<FileCompare>('GET', `${root(f, p.id)}/review/files?artifactId=artifact.secondary&path=src%2Fui%2Fpeople%2Findex.html`, undefined, ADMIN);
  expect(file.status, JSON.stringify(file.json)).toBe(200);
  expect(file.json.to.text).toBe('<h1>second implemented</h1>');
  expect(file.json.from.repo).toBe(secondRepo);
  const promotion = { expectedHead: review.expectedHead, candidateIds: review.bindings.map(b => b.candidateId), rationale: 'Reviewed both implementations' };
  expect((await call('POST', `${root(f, p.id)}/promote`, { ...promotion, candidateIds: promotion.candidateIds.slice(0, 1) }, ADMIN)).status).toBe(409);
  expect((await stub.state())!.manifest).toEqual(before!.manifest);
  const promoted = await call('POST', `${root(f, p.id)}/promote`, promotion, ADMIN);
  expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
  const after = (await stub.state())!;
  expect(after.genomeCommit).toBe(p.genome.commit);
  for (const binding of review.bindings) expect(after.manifest!.artifacts[binding.artifactId]).toMatchObject({ ...binding.source, realizedGenome: p.genome.commit, realizationPlan: p.id });
  expect((await stub.history()).length).toBe(2);
});

it('permits disjoint Genome advancement and records the older Genome actually realized', async () => {
  const f = await importFresh(), p = await planFor(f);
  await submitAndSelect(f, p, 'ui');
  const accepted = await genomeAmendment(f, files => files.set('external.observer/node.yaml', 'id: external.observer\nkind: external\nfields:\n  name: Observer\n'));
  const review = await integrate(f, p);
  const promoted = await call('POST', `${root(f, p.id)}/promote`, { expectedHead: review.expectedHead, candidateIds: review.bindings.map(b => b.candidateId), rationale: 'Disjoint Genome advance reviewed' }, ADMIN);
  expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
  const state = (await systemStub(env, f.systemId).state())!;
  expect(state.genomeCommit).toBe(accepted.commit);
  expect(state.manifest!.artifacts['artifact.webapp'].realizedGenome).toBe(p.genome.commit);
});

it('requires explicit replan after an overlapping accepted Genome change', async () => {
  const f = await importFresh(), p = await planFor(f);
  await submitAndSelect(f, p, 'ui');
  await genomeAmendment(f, renameContactAndScreen('Changed contract'));
  const before = (await systemStub(env, f.systemId).state())!;
  const result = await call<{ error: { code: string } }>('POST', `${root(f, p.id)}/integrate`, {}, ADMIN);
  expect(result.status).toBe(409); expect(result.json.error.code).toBe('replan-required');
  expect((await systemStub(env, f.systemId).state())!.head).toBe(before.head);
});

it('refuses a selected candidate superseded before integration', async () => {
  const f = await importFresh(), p = await planFor(f), selected = await submitAndSelect(f, p, 'ui');
  // Simulate a stale persisted selection from a competing candidate path. The public Task route already fences it.
  await runInDurableObject(env.SYSTEMS.getByName(f.systemId), (authority: SystemAuthority) => authority.recordCandidate({ realizationId: selected.attempt.realizationId, commit: 'c'.repeat(40), manifest: {}, changedPaths: ['src/ui/people/index.html'], changedNodes: ['screen.people'] }));
  const result = await call<{ error: { code: string } }>('POST', `${root(f, p.id)}/integrate`, {}, ADMIN);
  expect(result.status).toBe(409); expect(result.json.error.code).toBe('stale-candidate');
});
