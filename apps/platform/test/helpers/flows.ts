/** End-to-end System flows over the Worker's routes (import → promote → accept) for the compare and changelog tests. */
import { exports } from "cloudflare:workers";
import { expect } from "vitest";
import type { ImportSystemResponse, PromoteResponse, StartWorkResponse, SubmitResponse, SystemCommit } from "../../shared/api";
import { setArtifactsOverride } from "../../worker/artifacts/client";
import { walkTree } from "../../worker/artifacts/genome-source";
import type { Evaluation as HookEvaluation, HookRunner, SubmissionContext } from "../../worker/hooks/contract";
import { noopHookRunner } from "../../worker/hooks/index";
import { appFiles, genomeFiles, genomeFor } from "../fixtures/genome";
import { FakeArtifacts } from "./fake-artifacts";

export const ADMIN = { authorization: "Bearer test-admin-token" };
const secrets = new Map<string, string>();
let seq = 0;

export async function call<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: T }> {
  const rz = /\/realizations\/([^/]+)\/(submit|checkpoints|sync)$/.exec(path)?.[1];
  const auth = headers ?? (method === "POST" && /\/realizations$/.test(path) ? ADMIN : rz && secrets.has(rz) ? { authorization: `Bearer ${secrets.get(rz)}` } : {});
  const res = await exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method, headers: { "content-type": "application/json", ...auth }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  const json = (await res.json()) as T;
  const started = json as Partial<StartWorkResponse>;
  if (started.secret && started.realization?.id) secrets.set(started.realization.id, started.secret);
  return { status: res.status, json };
}

const REQUIRED = ["C.people.audit", "C.people.list", "C.people.sorted", "C.system.promotion", "C.webapp.exists"];

function hookEval(ctx: SubmissionContext, criterion: string, verdict: HookEvaluation["verdict"], execution: HookEvaluation["execution"] = "completed"): HookEvaluation {
  const at = new Date().toISOString();
  return {
    id: `${ctx.candidate.id}:hook:${criterion}`, candidate: ctx.candidate.id, hook: `hook:${criterion}`, criterion, ownerId: "o", subjectId: "s",
    targetRef: ctx.candidate.commit, execution, verdict, verifier: "artyfact-platform", startedAt: at,
    ...(execution === "completed" && { finishedAt: at }), observations: [], limitations: [], provenance: {},
  };
}

function evaluations(ctx: SubmissionContext): HookEvaluation[] {
  return REQUIRED.map((c) => {
    if (c !== "C.system.promotion") return hookEval(ctx, c, "pass");
    const f = ctx.promotionFacts;
    if (!f) return hookEval(ctx, c, "unknown", "not-run");
    return hookEval(ctx, c, f.currentBaseCommit === ctx.candidate.baseCommit && f.manifestExact && f.evidenceFresh ? "pass" : "fail");
  });
}

/** Every required criterion passes; the promotion criterion passes only with promotionFacts, as the real hook does. */
export const passing: HookRunner = {
  async runSubmission(ctx) { return evaluations(ctx); },
  async runGenome(ctx) { return { ...(await noopHookRunner.runGenome(ctx)), evaluations: evaluations(ctx) }; },
  async conflicts() { return []; },
};

/** Copies of evolution.1 (evolution.3, evolution.4) so a test can promote more than one app candidate. */
const extraEvolutions = Object.fromEntries([3, 4].map((n) => [
  `evolutions/evolution.${n}.yaml`,
  genomeFiles["evolutions/evolution.1.yaml"].replace("id: evolution.1", `id: evolution.${n}`).replace("title: List people", `title: People pass ${n}`),
]));

export interface Flow { ns: FakeArtifacts; systemId: string; genomeRepo: string; appRepo: string; imp: ImportSystemResponse; forks: number }

/** A freshly imported System with a unique id (DO names are global across tests). */
export async function importFresh(ns = new FakeArtifacts()): Promise<Flow> {
  const n = ++seq;
  const systemId = `system.cmp${n}${Math.random().toString(36).slice(2, 6)}`;
  const genomeRepo = `cmp-genome-${systemId.slice(10)}`, appRepo = `cmp-app-${systemId.slice(10)}`;
  ns.create(genomeRepo).commit({
    ...genomeFor(systemId), ...extraEvolutions,
  }, "genome");
  ns.create(appRepo).commit(appFiles, "scaffold");
  setArtifactsOverride(ns);
  const res = await call<ImportSystemResponse>("POST", "/systems/import", { systemId, genomeRepo, appRepo, review: false }, ADMIN);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { ns, systemId, genomeRepo, appRepo, imp: res.json, forks: 0 };
}

async function head(f: Flow): Promise<string | null> {
  return (await call<{ head: string | null }>("GET", `/systems/${f.systemId}`)).json.head;
}

/** Start an app realization on `evolution`, commit `files` (merged over its base commit's files) to its fork and submit. */
export async function submitApp(f: Flow, files: Record<string, string>, evolution = "evolution.1") {
  const start = await call<StartWorkResponse>("POST", `/systems/${f.systemId}/evolutions/${evolution}/realizations`, { agentLabel: "claude" });
  expect(start.status, JSON.stringify(start.json)).toBe(201);
  f.forks++;
  const forkRepo = start.json.realization.workspace.fork;
  const fork = f.ns.repo(forkRepo);
  const base = await walkTree(fork, start.json.realization.workspace.baseCommit);
  const commit = fork.commit({ ...Object.fromEntries(base), ...files }, "app change");
  const sub = await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${start.json.realization.id}/submit`, { commit });
  expect(sub.status, JSON.stringify(sub.json)).toBe(201);
  return { rid: start.json.realization.id, forkRepo, commit, candidate: sub.json.candidate.id };
}

export async function promoteApp(f: Flow, files: Record<string, string>, evolution = "evolution.1", rationale = "ship it") {
  const s = await submitApp(f, files, evolution);
  const p = await call<PromoteResponse>("POST", `/systems/${f.systemId}/promote`, { candidates: [s.candidate], expectedHead: await head(f), rationale }, ADMIN);
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  return { ...s, systemCommit: p.json.commit };
}

/** Start a Genome realization on evolution.2, apply `edit` to the canonical Genome files, submit and (optionally) accept. */
export async function genomeAmendment(f: Flow, edit: (files: Map<string, string>) => void, opts: { accept?: boolean } = {}) {
  const start = await call<StartWorkResponse>("POST", `/systems/${f.systemId}/evolutions/evolution.2/realizations`, {});
  expect(start.status, JSON.stringify(start.json)).toBe(201);
  f.forks++;
  const forkRepo = start.json.realization.workspace.fork;
  const fork = f.ns.repo(forkRepo);
  const baseCommit = start.json.realization.workspace.baseCommit;
  const files = await walkTree(fork, baseCommit);
  edit(files);
  const commit = fork.commit(files, "amend");
  const sub = await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${start.json.realization.id}/submit`, { commit });
  expect(sub.status, JSON.stringify(sub.json)).toBe(201);
  const out = { rid: start.json.realization.id, forkRepo, commit, candidate: sub.json.candidate.id, systemCommit: undefined as SystemCommit | undefined };
  if (opts.accept !== false) {
    const acc = await call<{ commit: SystemCommit }>("POST", `/systems/${f.systemId}/evolutions/evolution.2/accept`,
      { realizationId: out.rid, candidateId: out.candidate, commit, interpretation: "rename accepted" }, ADMIN);
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
    out.systemCommit = acc.json.commit;
  }
  return out;
}

const CONTACT = "thing.webapp/section.domain/entity.ContactRecord/node.yaml";
const PEOPLE = "thing.webapp/section.ui/screen.people/node.yaml";
export const renameContact = (name: string) => (files: Map<string, string>) =>
  files.set(CONTACT, files.get(CONTACT)!.replace("name: Contact record", `name: ${name}`));
/** Renames the People screen too, which the C.people.* criteria have as subject. */
export const renameContactAndScreen = (name: string) => (files: Map<string, string>) => {
  renameContact(name)(files);
  files.set(PEOPLE, files.get(PEOPLE)!.replace("name: People\n", "name: People v2\n"));
};
