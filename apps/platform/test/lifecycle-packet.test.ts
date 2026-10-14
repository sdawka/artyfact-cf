import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeTasks } from '@artyfact/model';
import type { SystemsResponse } from '../shared/api';
import { lifecyclePaths, type ImplementationReview, type PlanPromoteResponse, type RealizationPlan, type Task, type TaskAttempt, type TaskStartResponse, type TaskSubmitResponse } from '../shared/lifecycle';
import { setArtifactsOverride } from '../worker/artifacts/client';
import { walkTree } from '../worker/artifacts/genome-source';
import { setEditorTransport } from '../worker/editor';
import { resetHooks, setHooks } from '../worker/hooks';
import type { HookRunner } from '../worker/hooks/contract';
import { independenceStatement, lifecyclePacket, packetFields, waveOf } from '../worker/packets/lifecycle-packet';
import { evidenceBinds, systemStub } from '../worker/service';
import { fakeReceivePack } from './helpers/fake-receive-pack';
import { ADMIN, call, importFresh, passing, type Flow } from './helpers/flows';

const BASE = 'a'.repeat(40);
const future = () => new Date(Date.now() + 600_000).toISOString();
function attempt(taskId: string, status: TaskAttempt['status'], leaseExpiresAt = future()): TaskAttempt {
  return { id: `attempt.${taskId}`, taskId, generation: 1, realizationId: `realization.${taskId}`, status, agentLabel: 'agent', leaseExpiresAt, createdAt: BASE };
}
function task(id: string, globs: string[], o: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, artifactId: 'artifact.webapp', steps: ['Do it'], dependsOn: [], readNodes: [], writeNodes: [`screen.${id}`], checks: [],
    footprint: { repo: 'app', artifactId: 'artifact.webapp', globs, paths: globs, unmatched: [], known: true },
    planId: 'plan.1', status: 'pending', base: { repo: 'app', commit: BASE }, forkRepo: `app--${id}`, attempts: [], selectedCandidate: null, ...o,
  };
}
function plan(tasks: Task[]): RealizationPlan {
  return {
    id: 'plan.1', systemId: 'system.x', title: 'Plan', genome: { repo: 'genome', commit: 'g'.repeat(40) }, baseHead: null,
    baseManifest: { artifacts: {} } as unknown as RealizationPlan['baseManifest'], ontologyDigest: 'd', status: 'implementing', tasks,
    analysis: analyzeTasks(tasks), integration: [], createdAt: BASE, updatedAt: BASE,
  };
}
/** a selected; b working with a live lease; c builds on a; d shares a's files; e waits on c; f lives on another binding. */
function scenario(): RealizationPlan {
  return plan([
    task('a', ['src/a/**'], { status: 'selected', selectedCandidate: 'candidate.a', attempts: [attempt('a', 'ended')] }),
    task('b', ['src/b/**'], { status: 'working', attempts: [attempt('b', 'working')] }),
    task('c', ['src/c/**', 'src/shared.ts'], { dependsOn: ['a'], status: 'claimed', attempts: [attempt('c', 'claimed')] }),
    task('d', ['src/a/**'], { attempts: [attempt('d', 'claimed', new Date(Date.now() - 1000).toISOString())], status: 'claimed' }),
    task('e', ['src/e/**', 'src/shared.ts'], { dependsOn: ['c'] }),
  ]);
}

describe('lifecycle packet fields', () => {
  it('fills wave, independence, do-not-touch, concurrent and builds-on from the plan', () => {
    const p = scenario(), c = p.tasks.find((t) => t.id === 'c')!;
    expect(p.analysis.waves).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    const f = packetFields(p, c);
    expect(f.wave).toBe(2);
    expect(waveOf(p, 'nope')).toBeNull();
    expect(f.independence).toBe(
      'Independent of b, d: no shared source or ontology scope at aaaaaaaaaaaa. Ordered with a (wave 1) by a declared or ontology dependency. ' +
      'Ordered with e (wave 3) by a declared or ontology dependency. If you need a file another task owns, run `artyfact task checkpoint "needs:<path>"` and stop.',
    );
    // Other open tasks' globs minus c's own (src/shared.ts is c's too).
    expect(f.doNotTouch).toEqual([{ taskId: 'a', globs: ['src/a/**'] }, { taskId: 'b', globs: ['src/b/**'] }, { taskId: 'd', globs: ['src/a/**'] }, { taskId: 'e', globs: ['src/e/**'] }]);
    // b holds a live lease; d's lapsed and a's ended.
    expect(f.concurrent).toEqual([{ taskId: 'b', title: 'Task b', status: 'working', wave: 1 }]);
    expect(f.buildsOn).toEqual([{ taskId: 'a', title: 'Task a', candidateId: 'candidate.a' }]);
  });

  it('names source and ontology conflicts and leaves completed tasks out', () => {
    const p = scenario(), d = p.tasks.find((t) => t.id === 'd')!;
    expect(independenceStatement(p, d)).toContain('Shares source files src/a/** with a (wave 1); never both at once.');
    const done = plan(p.tasks.map((t) => (t.id === 'a' || t.id === 'b' ? { ...t, status: 'completed' as const } : t)));
    const f = packetFields(done, done.tasks.find((t) => t.id === 'd')!);
    expect(f.independence).not.toContain('with a ');
    expect(f.independence).toMatch(/^Independent of c, e:/);
    expect(f.doNotTouch.map((x) => x.taskId)).toEqual(['c', 'e']);
    const ontology = plan([task('x', ['src/x/**'], { writeNodes: ['screen.people'] }), task('y', ['src/y/**'], { readNodes: ['screen.people'] })]);
    expect(independenceStatement(ontology, ontology.tasks[1])).toContain('Shares ontology nodes screen.people with x (wave 1); never both at once.');
    const alone = plan([task('solo', ['src/**'])]);
    expect(independenceStatement(alone, alone.tasks[0])).toMatch(/^No other open task in this plan\. /);
  });

  it('renders AGENTS.md lines in order and keeps the markdown packet', () => {
    const p = scenario(), c = p.tasks.find((t) => t.id === 'c')!;
    const packet = lifecyclePacket({ plan: p, task: c, attempt: c.attempts[0], remote: 'https://git.example/app--c.git', reviewUrl: 'https://p.example/review' });
    const lines = packet.agentsMd!.trimEnd().split('\n');
    expect(lines).toEqual([
      'You are implementing task c (Task c) of plan plan.1 for system.x, wave 2. Read TASK_PACKET.md fully.',
      'Permitted edits: src/c/**, src/shared.ts.',
      'Do not touch: src/a/** (a); src/b/** (b); src/a/** (d); src/e/** (e); system/**, assays/**.',
      'Concurrent tasks: b (working, wave 1).',
      'Builds on: a (selected; its changes are in your base).',
      'After you: e starts once this task is selected.',
      'Implement only the pinned Genome, permitted paths, and Task scope. Run its checks.',
      'Check the attempt with `artyfact task status`.',
      'Checkpoint with `artyfact task checkpoint "What changed and what remains"`.',
      'Submit with `artyfact task submit`. The CLI reads the stored task token from .git/artyfact-task.json; never print, paste or copy it out.',
      'Never approve an Evolution, integrate, or promote without review.',
      'Return the durable review link: https://p.example/review',
    ]);
    expect(packet.markdown).toMatch(/^# Task c\n\nImplement accepted Genome g{40}\./);
    expect(packet.markdown).toContain('### Independence\nIndependent of b, d');
    expect(packet.markdown).toContain('### Builds on\n- `a` Task a, candidate `candidate.a`');
    expect(packet).toMatchObject({ wave: 2, permittedGlobs: ['src/c/**', 'src/shared.ts'], workspace: { remote: 'https://git.example/app--c.git', baseCommit: BASE } });
  });

  it('never lists a glob that covers or matches the task\'s own permitted edits', () => {
    const p = plan([task('wide', ['src/**']), task('same', ['src/a.ts']), task('other', ['docs/**']), task('mine', ['src/a.ts', 'lib/*.ts'], { footprint: { repo: 'app', artifactId: 'artifact.webapp', globs: ['src/a.ts', 'lib/*.ts'], paths: ['src/a.ts', 'lib/x.ts'], unmatched: [], known: true } }), task('narrow', ['lib/x.ts'])]);
    expect(packetFields(p, p.tasks[3]).doNotTouch).toEqual([{ taskId: 'other', globs: ['docs/**'] }]);
  });

  it('does not call tasks ordered through other dependencies independent', () => {
    const p = plan([task('a', ['src/a/**']), task('b', ['src/b/**'], { dependsOn: ['a'] }), task('c', ['src/c/**'], { dependsOn: ['b'] }), task('d', ['src/d/**'])]);
    const s = independenceStatement(p, p.tasks[0]);
    expect(s).toMatch(/^Independent of d: /);
    expect(s).toContain('Ordered with b (wave 2) by a declared or ontology dependency.');
    expect(s).toContain("Ordered with c (wave 3) through other tasks' dependencies.");
  });

  it('says when a dependency lives on another binding', () => {
    const p = plan([task('a', ['src/a/**'], { artifactId: 'artifact.api', footprint: { repo: 'api', artifactId: 'artifact.api', globs: ['src/a/**'], paths: [], unmatched: [], known: true }, status: 'selected', selectedCandidate: 'candidate.a' }), task('b', ['src/b/**'], { dependsOn: ['a'] })]);
    const b = p.tasks[1], packet = lifecyclePacket({ plan: p, task: b, attempt: attempt('b', 'claimed'), remote: 'r', reviewUrl: 'u' });
    expect(packet.agentsMd).toContain('Builds on: a (selected on artifact.api; not in this fork).');
    expect(packet.agentsMd).toContain('After you: no task waits on this one.');
  });
});

describe('evidenceBinds', () => {
  const commit = 'c'.repeat(40), genome = 'g'.repeat(40), preview = 'https://preview.example/c';
  it.each([
    ['a bare commit', commit, true],
    ['app@<commit>', `app@${commit}`, true],
    ['genome@<genomeCommit> (model-rules hooks)', `genome@${genome}`, true],
    ['the preview URL (http hooks)', preview, true],
    ['another commit', `app@${'d'.repeat(40)}`, false],
    ['another Genome', `genome@${'h'.repeat(40)}`, false],
    ['another URL', 'https://preview.example/other', false],
  ])('%s', (_label, ref, binds) => {
    expect(evidenceBinds(ref, { commit, previewUrl: preview }, genome)).toBe(binds);
  });
  it('never binds a preview URL when the candidate has none', () => {
    expect(evidenceBinds('', { commit }, genome)).toBe(false);
  });
});

const definition = { id: 'ui', title: 'People UI', artifactId: 'artifact.webapp', steps: ['Update people UI'], dependsOn: [], readNodes: [], writeNodes: ['screen.people'], checks: ['C.people.list'] };
const route = (s: string, p?: string, t?: string, a?: 'claim' | 'resume' | 'submit' | 'select') =>
  (a ? lifecyclePaths.action(s, p!, t!, a) : p ? lifecyclePaths.plan(s, p) : lifecyclePaths.plans(s)).replace(/^\/api/, '');
const PREVIEW = 'https://preview.example/integrated';

/** Every evaluation the runner records names the candidate through `ref` instead of its bare commit. */
function rewriting(ref: (commit: string, genomeCommit: string) => string): HookRunner {
  return { ...passing, async runSubmission(ctx) { return (await passing.runSubmission(ctx)).map((e) => ({ ...e, targetRef: ref(ctx.candidate.commit, ctx.genomeCommit) })); } };
}

async function walk(f: Flow, preview = false) {
  const created = await call<RealizationPlan>('POST', route(f.systemId), { title: 'Build', tasks: [definition] }, ADMIN);
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const p = created.json, s = (await call<TaskStartResponse>('POST', route(f.systemId, p.id, 'ui', 'claim'), {}, ADMIN)).json;
  const repo = f.ns.repo(s.task.forkRepo), files = await walkTree(repo, s.task.base.commit);
  files.set('src/ui/people/index.html', '<h1>People</h1>');
  const sub = await call<TaskSubmitResponse>('POST', route(f.systemId, p.id, 'ui', 'submit'), { attemptId: s.attempt.id, generation: s.attempt.generation, commit: repo.commit(files, 'UI') }, { authorization: `Bearer ${s.secret}` });
  expect(sub.status, JSON.stringify(sub.json)).toBe(201);
  expect((await call('POST', route(f.systemId, p.id, 'ui', 'select'), { candidateId: sub.json.candidate.id }, ADMIN)).status).toBe(200);
  const review = (await call<ImplementationReview>('POST', lifecyclePaths.integrate(f.systemId, p.id).replace(/^\/api/, ''), {}, ADMIN)).json;
  if (preview) expect(await systemStub(env, f.systemId).setPreviewUrl(review.bindings[0].candidateId, PREVIEW)).toBe(true);
  return call<PlanPromoteResponse>('POST', lifecyclePaths.promote(f.systemId, p.id).replace(/^\/api/, ''), { expectedHead: review.expectedHead, rationale: 'Reviewed', candidateIds: review.bindings.map((b) => b.candidateId) }, ADMIN);
}

describe('lifecycle evidence freshness', () => {
  beforeEach(() => setHooks({ runner: () => passing }));
  afterEach(() => { resetHooks(); setArtifactsOverride(undefined); setEditorTransport(undefined); });
  it.each([
    ['a bare commit', (c: string) => c, false],
    ['app@<commit>', (c: string) => `app@${c}`, false],
    ['genome@<genomeCommit>', (_c: string, g: string) => `genome@${g}`, false],
    ['the integrated preview URL', () => PREVIEW, true],
  ])('accepts evidence bound by %s at promotion', async (_label, ref, preview) => {
    setHooks({ runner: () => rewriting(ref) });
    const f = await importFresh();
    setEditorTransport({ fetch: fakeReceivePack(f.ns).fetch });
    const promoted = await walk(f, preview);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
  });
  it('judges the latest evaluation per criterion, not any earlier one', async () => {
    // Each criterion first passes on the candidate, then a later evaluation of it binds another commit.
    const later: HookRunner = { ...passing, async runSubmission(ctx) {
      const out = await passing.runSubmission(ctx), at = new Date(Date.now() + 60_000).toISOString();
      return ctx.trigger === 'promotion' ? out : [...out, ...out.filter((e) => e.execution === 'completed').map((e) => ({ ...e, id: `${e.id}:later`, hook: `${e.hook}:later`, targetRef: `app@${'0'.repeat(40)}`, startedAt: at, finishedAt: at }))];
    } };
    setHooks({ runner: () => later });
    const f = await importFresh();
    setEditorTransport({ fetch: fakeReceivePack(f.ns).fetch });
    const promoted = await walk(f);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(409);
    expect((promoted.json as unknown as { error: { code: string } }).error.code).toBe('blocked');
  });
  it('refuses evidence bound to another commit', async () => {
    setHooks({ runner: () => rewriting(() => `app@${'0'.repeat(40)}`) });
    const f = await importFresh();
    setEditorTransport({ fetch: fakeReceivePack(f.ns).fetch });
    const promoted = await walk(f);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(409);
    const error = (promoted.json as unknown as { error: { code: string; message: string; details: { criteria: { criterion: string; verdict: string; severity: string }[]; advisories: unknown[] } } }).error;
    expect(error.code).toBe('blocked');
    expect(error.message).toBe('blocking criteria (hard, with a bound hook) lack pass+completed evaluations');
    expect(error.details.criteria).toEqual([expect.objectContaining({ criterion: 'C.system.promotion', verdict: 'fail', severity: 'hard' })]);
    expect(error.details.advisories).toEqual(expect.any(Array));
  });
});

describe('lifecycle packet over HTTP and registry freshness', () => {
  beforeEach(() => setHooks({ runner: () => passing }));
  afterEach(() => { resetHooks(); setArtifactsOverride(undefined); setEditorTransport(undefined); });

  it('returns packet fields from the claimed plan and never the token or secret', async () => {
    const f = await importFresh();
    const two = [definition, { ...definition, id: 'more', title: 'More', writeNodes: ['screen.people'] }];
    const p = (await call<RealizationPlan>('POST', route(f.systemId), { title: 'Build', tasks: two }, ADMIN)).json;
    const s = await call<TaskStartResponse>('POST', route(f.systemId, p.id, 'ui', 'claim'), {}, ADMIN);
    expect(s.status, JSON.stringify(s.json)).toBe(201);
    const { packet, secret, token } = s.json;
    expect(packet.wave).toBe(2);
    expect(packet.independence).toContain('Shares ontology nodes');
    expect(packet.independence).toContain('with more (wave 1); never both at once.');
    expect(packet.concurrent).toEqual([]);
    expect(packet.buildsOn).toEqual([]);
    expect(packet.agentsMd).toContain(`You are implementing task ui (People UI) of plan ${p.id} for ${f.systemId}, wave 2.`);
    expect(packet.markdown).toContain('# People UI');
    const text = JSON.stringify(packet);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(token.value);
  });

  it('refreshes the registry after create, claim, submit, select, integrate and promote', async () => {
    const f = await importFresh();
    setEditorTransport({ fetch: fakeReceivePack(f.ns).fetch });
    const counts = async () => (await call<SystemsResponse>('GET', '/systems')).json.systems.find((s) => s.systemId === f.systemId)!.planCounts;
    const p = (await call<RealizationPlan>('POST', route(f.systemId), { title: 'Build', tasks: [definition] }, ADMIN)).json;
    expect(await counts()).toEqual({ open: 1, awaitingAgent: 1, submitted: 0, integrated: 0 });
    const s = (await call<TaskStartResponse>('POST', route(f.systemId, p.id, 'ui', 'claim'), {}, ADMIN)).json;
    expect(await counts()).toEqual({ open: 1, awaitingAgent: 0, submitted: 0, integrated: 0 });
    const repo = f.ns.repo(s.task.forkRepo), files = await walkTree(repo, s.task.base.commit);
    files.set('src/ui/people/index.html', '<h1>People</h1>');
    const sub = (await call<TaskSubmitResponse>('POST', route(f.systemId, p.id, 'ui', 'submit'), { attemptId: s.attempt.id, generation: s.attempt.generation, commit: repo.commit(files, 'UI') }, { authorization: `Bearer ${s.secret}` })).json;
    expect(await counts()).toEqual({ open: 1, awaitingAgent: 0, submitted: 1, integrated: 0 });
    await call('POST', route(f.systemId, p.id, 'ui', 'select'), { candidateId: sub.candidate.id }, ADMIN);
    expect(await counts()).toEqual({ open: 1, awaitingAgent: 0, submitted: 0, integrated: 0 });
    const review = (await call<ImplementationReview>('POST', lifecyclePaths.integrate(f.systemId, p.id).replace(/^\/api/, ''), {}, ADMIN)).json;
    expect(await counts()).toEqual({ open: 1, awaitingAgent: 0, submitted: 0, integrated: 1 });
    const promoted = await call('POST', lifecyclePaths.promote(f.systemId, p.id).replace(/^\/api/, ''), { expectedHead: review.expectedHead, rationale: 'Reviewed', candidateIds: review.bindings.map((b) => b.candidateId) }, ADMIN);
    expect(promoted.status, JSON.stringify(promoted.json)).toBe(200);
    expect(await counts()).toEqual({ open: 0, awaitingAgent: 0, submitted: 0, integrated: 0 });
  });

});
