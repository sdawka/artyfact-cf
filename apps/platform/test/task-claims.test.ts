import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemOne } from "@artyfact/semantic";
import type {
  ApiError, CandidatesResponse, ClaimTaskResponse, Evaluation, PromoteResponse, StartWaveResponse, SubmitResponse, Task, TaskPlan, TaskResponse, TasksResponse,
} from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { buildGenome, walkTree } from "../worker/artifacts/genome-source";
import type { SystemAuthority } from "../worker/do/system-authority";
import type { HookRunner, SubmissionContext } from "../worker/hooks/contract";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { createHookRunner } from "../worker/hooks/run";
import { taskFootprint } from "../worker/tasks/footprint";
import { taskConflicts, waves } from "../worker/tasks/independence";
import { appFiles, genomeFiles } from "./fixtures/genome";
import { ADMIN, call, importFresh, passing, type Flow } from "./helpers/flows";

beforeEach(() => setHooks({ runner: () => passing }));
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

// ---------------------------------------------------------------- waves and claims (W5)

const model = buildGenome(new Map(Object.entries(genomeFiles).filter(([p]) => p.endsWith(".yaml"))), "g1").model;
const inDo = <T>(systemId: string, fn: (i: SystemAuthority) => T | Promise<T>) => runInDurableObject(env.SYSTEMS.getByName(systemId), fn);

const A = "task.people", B = "task.save", C = "task.record";

/**
 * evolution.1 planned into three tasks: A (People screen), B (save operation) and C (contact record, after A).
 * B and C share `src/worker/routes/contacts.ts`, so the waves are [[A, B], [C]].
 */
async function planned(f: Flow, over: Partial<Record<string, Partial<Task>>> = {}): Promise<TaskPlan> {
  const head = await inDo(f.systemId, (i) => i.state()!);
  const tree = Object.keys(appFiles);
  const t = (id: string, nodes: string[], extra: Partial<Task> = {}): Task => ({
    id, evolutionId: "evolution.1", title: `Do ${id}`, intent: `Intent of ${id}`, thing: "thing.webapp", nodes,
    footprint: taskFootprint({ model, nodes, tree, appCommit: head.appSource!.commit }), acceptanceCriteria: ["C.people.list"], dependsOn: [],
    status: "planned", origin: "fallback", ...extra, ...over[id],
  });
  const tasks = [t(A, ["screen.people"]), t(B, ["operation.contact.save"]), t(C, ["entity.ContactRecord"], { dependsOn: [A] })];
  const conflicts = taskConflicts(tasks, model);
  const plan: TaskPlan = {
    version: 1, evolutionId: "evolution.1", genomeCommit: head.genomeCommit, appCommit: head.appSource!.commit, tasks, conflicts,
    waves: waves(tasks, conflicts), problems: [], provenance: { planner: { provider: "fake", model: "fake" }, fake: true },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  return inDo(f.systemId, (i) => i.putPlan(plan));
}

const sys = (f: Flow) => `/systems/${f.systemId}`;
const claim = (f: Flow, task: string, agentLabel: string) => call<ClaimTaskResponse & ApiError>("POST", `${sys(f)}/tasks/${task}/claim`, { agentLabel }, ADMIN);

/** Commit `files` over the claimed fork's base and submit them. */
async function submitClaimed(f: Flow, c: ClaimTaskResponse, files: Record<string, string>) {
  const fork = f.ns.repo(c.realization.workspace.fork);
  const base = await walkTree(fork, c.realization.workspace.baseCommit);
  const commit = fork.commit({ ...Object.fromEntries(base), ...files }, "task change");
  const sub = await call<SubmitResponse>("POST", `${sys(f)}/realizations/${c.realization.id}/submit`, { commit });
  expect(sub.status, JSON.stringify(sub.json)).toBe(201);
  return sub.json;
}

describe("waves", () => {
  it("starts wave 1 with task-scoped packets, lists tasks, and refuses wave 2 until wave 1 is promoted", async () => {
    const f = await importFresh();
    const plan = await planned(f);
    expect(plan.waves).toEqual([[A, B], [C]]);

    const res = await call<StartWaveResponse>("POST", `${sys(f)}/evolutions/evolution.1/waves/1/start`, { agentLabels: { [A]: "claude:a" } }, ADMIN);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.wave).toBe(1);
    expect(res.json.skipped).toEqual([]);
    expect(res.json.started.map((s) => s.task)).toEqual([A, B]);
    const [a, b] = res.json.started;
    for (const [s, id] of [[a, A], [b, B]] as const) {
      const footprint = plan.tasks.find((t) => t.id === id)!.footprint;
      expect(s.packet.permittedPaths.sort()).toEqual([...footprint.globs].sort());
      expect(s.packet.task).toMatchObject({ id, wave: 1 });
      expect(s.packet.markdown).toContain("## Task");
      expect(s.packet.agentsMd.split("\n")[1]).toBe(`You are realizing task ${id} (Do ${id}) of evolution.1 for ${f.systemId}. Read TASK_PACKET.md fully.`);
      expect(s.token.value).toBeTruthy();
      expect(s.realization.task).toBe(id);
    }
    expect(a.realization.agent.id).toBe("claude:a");
    expect(b.realization.agent.id).toBe(`agent:${B}`);
    // A goes first: B is a planned sibling; B's packet sees A running, with its globs.
    expect(a.packet.agentsMd).toContain(`${B} (`);
    expect(a.packet.agentsMd).toContain(`After you: ${C} starts when this task is promoted.`);
    expect(a.packet.task!.independence).toContain(`Independent of ${B}`);
    expect(b.packet.concurrentWork).toContainEqual(expect.objectContaining({
      realization: a.realization.id, evolution: "evolution.1", task: A, permittedPaths: a.packet.permittedPaths,
    }));
    expect(b.packet.agentsMd).toContain(`Concurrent tasks: ${A} of evolution.1`);

    const claimed = await call<TasksResponse>("GET", `${sys(f)}/tasks?status=claimed`);
    expect(claimed.json.tasks.map((t) => [t.id, t.status, t.wave, t.realizationId])).toEqual([[A, "claimed", 1, a.realization.id], [B, "claimed", 1, b.realization.id]]);
    const open = await call<TasksResponse>("GET", `${sys(f)}/tasks?status=planned`);
    expect(open.json.tasks).toEqual([expect.objectContaining({ id: C, evolutionTitle: "List people", wave: 2, blockedOn: [A] })]);
    expect(open.json.waves).toEqual({ "evolution.1": [[A, B], [C]] });
    expect(open.json.conflicts.every((c) => c.tasks.includes(C))).toBe(true);
    expect((await call<ApiError>("GET", `${sys(f)}/tasks?status=done`)).status).toBe(400);

    const blocked = await call<ApiError>("POST", `${sys(f)}/evolutions/evolution.1/waves/2/start`, {}, ADMIN);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatchObject({ code: "wave-blocked", details: { pending: [A, B] } });
    // Forced, C still waits on its dependency: skipped, not started.
    const forced = await call<StartWaveResponse>("POST", `${sys(f)}/evolutions/evolution.1/waves/2/start`, { force: true }, ADMIN);
    expect(forced.status).toBe(200);
    expect(forced.json).toEqual({ wave: 2, started: [], skipped: [{ task: C, reason: `blocked by ${A} (not yet promoted)` }] });

    // Once wave 1 is promoted, wave 2 starts.
    await inDo(f.systemId, (i) => { i.setTaskStatus(A, "promoted"); i.setTaskStatus(B, "promoted"); });
    const next = await call<StartWaveResponse>("POST", `${sys(f)}/evolutions/evolution.1/waves/2/start`, {}, ADMIN);
    expect(next.status, JSON.stringify(next.json)).toBe(200);
    expect(next.json.started.map((s) => s.task)).toEqual([C]);
    expect(next.json.started[0].packet.agentsMd).toContain("After you: no task waits on this one.");

    expect((await call<ApiError>("POST", `${sys(f)}/evolutions/evolution.1/waves/3/start`, {}, ADMIN)).status).toBe(404);
    expect((await call<ApiError>("POST", `${sys(f)}/evolutions/evolution.1/waves/0/start`, {}, ADMIN)).status).toBe(404);
    expect((await call<ApiError>("POST", `${sys(f)}/evolutions/evolution.1/waves/1/start`, {})).status).toBe(401);
  });

  it("starts a wave-2 task with force when only files (not dependencies) put it there", async () => {
    const f = await importFresh();
    const plan = await planned(f, { [C]: { dependsOn: [] } });
    // Greedy colouring in id order: C (task.record) takes wave 1, B shares its file and moves to wave 2.
    expect(plan.waves).toEqual([[A, C], [B]]);
    expect((await call<ApiError>("POST", `${sys(f)}/evolutions/evolution.1/waves/2/start`, {}, ADMIN)).json.error.code).toBe("wave-blocked");
    const forced = await call<StartWaveResponse>("POST", `${sys(f)}/evolutions/evolution.1/waves/2/start`, { force: true }, ADMIN);
    expect(forced.json.started.map((s) => s.task)).toEqual([B]);
  });

  it("answers 404 no-plan for an Evolution without a plan", async () => {
    const f = await importFresh();
    const res = await call<ApiError>("POST", `${sys(f)}/evolutions/evolution.1/waves/1/start`, {}, ADMIN);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("no-plan");
  });
});

describe("claims", () => {
  it("claims fresh, returns the same claim to its label, refuses others and blocked tasks, and reopens on release", async () => {
    const f = await importFresh();
    await planned(f);
    const first = await claim(f, A, "claude:a");
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    expect(first.json).toMatchObject({ fresh: true, task: { id: A, status: "claimed", claim: { agentLabel: "claude:a" } } });
    expect(first.json.token?.value).toBeTruthy();
    expect(first.json.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(first.json.packet.task?.id).toBe(A);
    expect(first.json.task.realizationId).toBe(first.json.realization.id);

    const again = await claim(f, A, "claude:a");
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ fresh: false, token: null, secret: null });
    expect(again.json.realization.id).toBe(first.json.realization.id);
    expect(again.json.packet.hash).toBe(first.json.packet.hash);
    expect(again.json.cli).not.toContain(first.json.secret!);

    const taken = await claim(f, A, "claude:other");
    expect(taken.status).toBe(409);
    expect(taken.json.error).toMatchObject({ code: "task-taken", details: { by: "claude:a" } });
    const blocked = await claim(f, C, "claude:c");
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatchObject({ code: "task-blocked", details: { blockedOn: [A] } });
    expect((await claim(f, "task.nope", "x")).status).toBe(404);
    expect((await call<ApiError>("POST", `${sys(f)}/tasks/${A}/claim`, { agentLabel: "" }, ADMIN)).status).toBe(400);
    expect((await call<ApiError>("POST", `${sys(f)}/tasks/${A}/claim`, { agentLabel: "x" })).status).toBe(401);

    const one = await call<TaskResponse>("GET", `${sys(f)}/tasks/${A}`);
    expect(one.json.task.status).toBe("claimed");
    expect(one.json.conflicts).toContainEqual(expect.objectContaining({ kind: "declared", tasks: [C, A].sort() }));

    // After the first checkpoint the task is realizing; its label still gets it back.
    await call("POST", `${sys(f)}/realizations/${first.json.realization.id}/checkpoints`, { summary: "started" });
    expect((await call<TaskResponse>("GET", `${sys(f)}/tasks/${A}`)).json.task.status).toBe("realizing");
    expect((await claim(f, A, "claude:a")).json).toMatchObject({ fresh: false, token: null });

    const released = await call<TaskResponse>("POST", `${sys(f)}/tasks/${A}/release`, {}, ADMIN);
    expect(released.status).toBe(200);
    expect(released.json.task).toMatchObject({ id: A, status: "planned" });
    expect(released.json.task.claim).toBeUndefined();
    const retake = await claim(f, A, "claude:other");
    expect(retake.status).toBe(201);
    expect(retake.json.realization.id).not.toBe(first.json.realization.id);
  });

  it("fails the scope hook when a task's submit touches a path outside its globs", async () => {
    setHooks({ runner: () => createHookRunner({ s1: createSystemOne({}), fetch: (async () => { throw new Error("no preview"); }) as typeof fetch, previewEnv: {} }) });
    const f = await importFresh();
    await planned(f);
    const c = (await claim(f, A, "claude:a")).json;
    expect(c.packet.permittedPaths).not.toContain("src/worker/routes/contacts.ts");
    const sub = await submitClaimed(f, c, { "src/ui/people/index.html": "<main>v2</main>", "src/worker/routes/contacts.ts": "changed" });
    const scope = sub.evaluations.filter((e: Evaluation) => e.criterion === "C.system.promotion");
    expect(scope.length).toBeGreaterThan(0);
    expect(scope[0].verdict).toBe("fail");
    expect(JSON.stringify(scope[0].observations)).toContain("src/worker/routes/contacts.ts");
  });

  it("evaluates and gates a task candidate on the task's criteria only", async () => {
    const seen: string[][] = [];
    // C.people.list (an acceptance criterion of evolution.1, not of the task) fails.
    const runner: HookRunner = {
      ...passing,
      async runSubmission(ctx: SubmissionContext) {
        seen.push(ctx.evolution?.acceptanceCriteria ?? []);
        return (await passing.runSubmission(ctx)).map((e) => (e.criterion === "C.people.list" ? { ...e, verdict: "fail" as const } : e));
      },
    };
    setHooks({ runner: () => runner });
    const f = await importFresh();
    await planned(f, { [A]: { acceptanceCriteria: ["C.webapp.exists"] } });
    const c = (await claim(f, A, "claude:a")).json;
    expect(c.packet.acceptanceCriteria.map((x) => x.id)).toEqual(["C.webapp.exists"]);
    const sub = await submitClaimed(f, c, { "src/ui/people/index.html": "<main>v2</main>" });
    expect(seen[0]).toEqual(["C.webapp.exists"]);

    const view = await call<CandidatesResponse>("GET", `${sys(f)}/evolutions/evolution.1/candidates`);
    const gate = view.json.gates![sub.candidate.id].map((g) => g.id);
    expect(gate).toContain("C.webapp.exists");
    expect(gate).not.toContain("C.people.list");

    const head = (await call<{ head: string | null }>("GET", sys(f))).json.head;
    const p = await call<PromoteResponse & ApiError>("POST", `${sys(f)}/promote`, { candidates: [sub.candidate.id], expectedHead: head, rationale: "task A" }, ADMIN);
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect((await call<TaskResponse>("GET", `${sys(f)}/tasks/${A}`)).json.task.status).toBe("promoted");
    // C's dependency is promoted: it can be claimed now.
    expect((await claim(f, C, "claude:c")).status).toBe(201);
  });
});

describe("claims: atomicity and leases", () => {
  const lapse = (f: Flow, task: string) => runInDurableObject(env.SYSTEMS.getByName(f.systemId), async (_i: SystemAuthority, state) => {
    state.storage.sql.exec("UPDATE tasks SET claim_expires = ? WHERE id = ?", new Date(Date.now() - 60_000).toISOString(), task);
  });
  const taskOf = async (f: Flow, id: string) => (await call<TaskResponse>("GET", `${sys(f)}/tasks/${id}`)).json.task;

  it("lets exactly one of two concurrent claims start work", async () => {
    const f = await importFresh();
    await planned(f);
    const [x, y] = await Promise.all([claim(f, A, "claude:x"), claim(f, A, "claude:y")]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const lost = x.status === 409 ? x : y;
    expect(["invalid-state", "task-taken"]).toContain(lost.json.error.code);
    const reals = (await call<{ realizations: { task?: string }[] }>("GET", `${sys(f)}/realizations`)).json.realizations;
    expect(reals.filter((r) => r.task === A)).toHaveLength(1);
  });

  it("refuses any claim while a claim's realization is reserved but not yet active", async () => {
    const f = await importFresh();
    await planned(f);
    // Claim and reserve without the fork and activation that follow: the gap a slow start leaves.
    const out = await inDo(f.systemId, (i) => i.claimAndReserve({ evolutionId: "evolution.1", target: "app", taskId: B, agentLabel: "claude:b" }));
    expect(out).toMatchObject({ fresh: true });
    for (const label of ["claude:b", "claude:other"]) {
      const res = await claim(f, B, label);
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("invalid-state");
      expect(res.json.error.message).toContain("claim in progress");
    }
    // Once a claim's realization is active, its label gets it back.
    const a = await claim(f, A, "claude:a");
    expect(a.status).toBe(201);
    expect((await claim(f, A, "claude:a")).status).toBe(200);
  });

  it("renews the lease on checkpoint and on submit", async () => {
    const f = await importFresh();
    await planned(f);
    const c = (await claim(f, A, "claude:a")).json;
    await lapse(f, A);
    expect(Date.parse((await taskOf(f, A)).claim!.expiresAt)).toBeLessThan(Date.now());
    await call("POST", `${sys(f)}/realizations/${c.realization.id}/checkpoints`, { summary: "working" });
    expect(Date.parse((await taskOf(f, A)).claim!.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000);
    await lapse(f, A);
    await submitClaimed(f, c, { "src/ui/people/index.html": "<main>v2</main>" });
    expect(Date.parse((await taskOf(f, A)).claim!.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it("gives a lapsed claim back to its own label with the stored packet", async () => {
    const f = await importFresh();
    await planned(f);
    const first = (await claim(f, A, "claude:a")).json;
    await lapse(f, A);
    const again = await claim(f, A, "claude:a");
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ fresh: false, token: null, secret: null });
    expect(again.json.realization.id).toBe(first.realization.id);
    expect(Date.parse(again.json.task.claim!.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it("abandons the earlier realization when another label takes over a lapsed claim", async () => {
    const f = await importFresh();
    await planned(f);
    const first = (await claim(f, A, "claude:a")).json;
    await lapse(f, A);
    const next = await claim(f, A, "claude:b");
    expect(next.status, JSON.stringify(next.json)).toBe(201);
    expect(next.json.realization.id).not.toBe(first.realization.id);
    expect(next.json.task).toMatchObject({ status: "claimed", realizationId: next.json.realization.id, claim: { agentLabel: "claude:b" } });
    const old = await inDo(f.systemId, (i) => i.realization(first.realization.id)!);
    expect(old.realization.status).toBe("abandoned");
    // Its secret was revoked with it: the earlier agent can no longer submit.
    const fork = f.ns.repo(first.realization.workspace.fork);
    const base = await walkTree(fork, first.realization.workspace.baseCommit);
    const commit = fork.commit({ ...Object.fromEntries(base), "src/ui/people/index.html": "late" }, "late");
    const late = await call<ApiError>("POST", `${sys(f)}/realizations/${first.realization.id}/submit`, { commit });
    expect(late.status).toBeGreaterThanOrEqual(400);
  });
});

describe("task criteria with the real hook runner", () => {
  beforeEach(() => {
    setHooks({ runner: () => createHookRunner({ s1: createSystemOne({}), fetch: (async () => { throw new Error("no preview"); }) as typeof fetch, previewEnv: {} }) });
  });

  it("evaluates a task criterion outside the Genome Evolution's list", async () => {
    const f = await importFresh();
    await planned(f, { [A]: { acceptanceCriteria: ["C.webapp.health"] } });
    expect(model.evolutions.find((e) => e.id === "evolution.1")!.acceptanceCriteria).not.toContain("C.webapp.health");
    const c = (await claim(f, A, "claude:a")).json;
    const sub = await submitClaimed(f, c, { "src/ui/people/index.html": "<main>v2</main>" });
    const health = sub.evaluations.filter((e) => e.criterion === "C.webapp.health");
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ provenance: { selectedBy: "acceptance" } });
    // The Evolution's own acceptance criterion is not selected as acceptance for the task.
    expect(sub.evaluations.filter((e) => e.criterion === "C.people.sorted" && (e.provenance as { selectedBy?: string }).selectedBy === "acceptance")).toEqual([]);
  });

  it("names the tasks of conflicting candidates", async () => {
    const f = await importFresh();
    await planned(f);
    const a = (await claim(f, A, "claude:a")).json;
    const b = (await claim(f, B, "claude:b")).json;
    await submitClaimed(f, a, { "src/ui/people/index.html": "<main>a</main>" });
    const sub = await submitClaimed(f, b, { "src/ui/people/index.html": "<main>b</main>" });
    const file = sub.conflicts.find((c) => c.kind === "file");
    expect(file, JSON.stringify(sub.conflicts)).toBeDefined();
    expect(file!.tasks).toEqual([A, B].sort());
  });
});
