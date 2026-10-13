/**
 * Intents: a message about the System becomes a proposal of node updates (route → translate → validate on the head
 * Genome), a reply revises it, and accepting a subset writes those ops to the Genome through an ordinary Genome
 * realization and candidate. Spec: docs/design/ontology.md §4–§6.
 */
import {
  applyOps, BASE_TEMPLATE, diffFindings, evaluate, GenomeTreeError, isLegacyGenome, mintId, parseTree, projectTree,
  providerFromEnv, readTree, route, ROUTE_NEW, ROUTE_NONE, ROUTE_UNCLEAR, routeSlice, routeVocabulary, titleOf, translatorFromEnv,
  TreeOpError, validateOps, type Graph, type Op, type ProviderEnv, type Readiness, type Route, type SystemOne, type Template,
  type Translation, type Translator, type TranslatorEnv, type TreeOp,
} from "@artyfact/ontology";
import { composeTemplate, metaTemplates } from "@artyfact/templates";
import type { IntentAcceptResponse, Proposal, ProposalProblem, ProposalQuestion, ProposedOp } from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { genomePrefix } from "./artifacts/genome-source";
import type { HeadState } from "./do/system-authority";
import type { ProposalTurn } from "./do/proposals-store";
import { commitEdit } from "./editor";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { createEvolution, genomeAt, refreshRegistry, revokeEnded, startWork, systemStub } from "./service";
import { nowIso } from "./util";

/** The agent label of an intent's Genome realization; its commits are authored as `intent`. */
export const INTENT_AGENT = "human:intent";
const MAX_MESSAGE = 4000;

// ------------------------------------------------------------------ providers

export interface IntentProviders { s1: SystemOne; translator: Translator }

let override: Partial<IntentProviders> = {};
/** Test hook: route and translate with these instead of the env's providers (undefined restores the env). */
export function setIntentProviders(p: Partial<IntentProviders> | undefined): void {
  override = p ?? {};
}

/**
 * System One for routing and the translator. `FAKE_S1=1` gives the fakes; else System One is TypeSafe
 * (`TYPESAFE_API_KEY`), then OpenRouter (`OPENROUTER_API_KEY`), and the translator OpenRouter; else off. The one place
 * intents pick providers; the gates use the same `providerFromEnv`.
 */
export function intentProviders(env: Env): IntentProviders {
  return {
    s1: override.s1 ?? providerFromEnv(env as unknown as ProviderEnv),
    translator: override.translator ?? translatorFromEnv(env as unknown as TranslatorEnv),
  };
}

// ------------------------------------------------------------------ head Genome

interface HeadGenome { state: HeadState; files: Map<string, string>; graph: Graph; template: Template; readiness: Readiness }

/**
 * The engine's view of a v2 Genome: the graph, the System template with its Things' templates laid over it, and the
 * readiness proposals are compared against.
 */
export function genomeGraph(files: Map<string, string>): { graph: Graph; template: Template; readiness: Readiness } {
  if (isLegacyGenome(files.keys())) throw unprocessable("legacy-genome", "this revision predates the node-tree Genome format");
  let tree;
  try {
    tree = parseTree(files);
  } catch (e) {
    if (e instanceof GenomeTreeError) throw unprocessable("invalid-genome", e.message);
    throw e;
  }
  const nodes = [...tree.nodes.values()];
  const things = [...new Set(nodes.flatMap((n) => (n.file.kind === "thing" && n.file.template ? [n.file.template] : [])))];
  const template = composeTemplate(tree.nodes.get(tree.root)!.file.template ?? BASE_TEMPLATE, things);
  const graph = projectTree(tree, metaTemplates);
  return { graph, template, readiness: evaluate(template, graph) };
}

const memo = new Map<string, ReturnType<typeof genomeGraph>>();
const MEMO_MAX = 8;

async function headGenome(env: Env, systemId: string): Promise<HeadGenome> {
  const state = await systemStub(env, systemId).state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const { files } = await genomeAt(env, systemId, state.genomeCommit, state.genomeSource);
  const key = `${systemId}@${state.genomeCommit}`;
  let g = memo.get(key);
  if (!g) {
    g = genomeGraph(files);
    memo.set(key, g);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  }
  return { state, files, ...g };
}

// ------------------------------------------------------------------ one turn: route → translate → validate

type Turn = Pick<Proposal, "route" | "ops" | "questions" | "problems" | "answer" | "provenance">;

/** The field a kind shows as its name: its `view.title`, else `title`, else `name` when the kind declares only that. */
function titleField(template: Template, kind: string): string {
  const k = template.kinds[kind];
  const declared = k?.fields?.map((f) => f.name) ?? [];
  return k?.view?.title ?? (!declared.includes("title") && declared.includes("name") ? "name" : "title");
}

/**
 * Engine ops as proposed ops `op.<n>`. An `add` gets a minted id (`<kind>.<slug of title>`), its title (under the
 * kind's name field, see titleField) and description go into `fields`, and each of its links becomes a `link` op
 * depending on it. `first[i]` is the proposed op for engine op `i`.
 */
export function proposedOps(engine: Op[], graph: Graph, template: Template): { ops: ProposedOp[]; first: string[] } {
  const taken = new Set(graph.nodes.map((n) => n.id));
  const ops: ProposedOp[] = [];
  const first: string[] = [];
  const push = (op: Omit<ProposedOp, "id">) => {
    const id = `op.${ops.length + 1}`;
    ops.push({ id, ...op });
    return id;
  };
  engine.forEach((op, i) => {
    switch (op.op) {
      case "add": {
        const node = mintId(op.kind, op.title, taken);
        taken.add(node);
        const fields = { ...op.fields, [titleField(template, op.kind)]: op.title, ...(op.description !== undefined && { description: op.description }) };
        const add = push({ op: "add", node, kind: op.kind, ...(op.parent && { parent: op.parent }), fields, ...(op.criteria?.length && { criteria: op.criteria }) });
        first[i] = add;
        for (const l of op.links ?? []) {
          push(l.to !== undefined
            ? { op: "link", node, link: { rel: l.rel, to: l.to }, dependsOn: [add] }
            : { op: "link", node: l.from!, link: { rel: l.rel, to: node }, dependsOn: [add] });
        }
        break;
      }
      case "update":
        first[i] = push({ op: "update", node: op.id, ...(op.fields && { fields: op.fields }), ...(op.criteria && { criteria: op.criteria }) });
        break;
      case "remove":
        first[i] = push({ op: "remove", node: op.id });
        break;
      default:
        first[i] = push({ op: op.op, node: op.from, link: { rel: op.rel, to: op.to } });
    }
  });
  return { ops, first };
}

/** Files after `changes` (a `null` content deletes the file). */
function withChanges(files: Map<string, string>, changes: { path: string; content: string | null }[]): Map<string, string> {
  const out = new Map(files);
  for (const c of changes) {
    if (c.content === null) out.delete(c.path);
    else out.set(c.path, c.content);
  }
  return out;
}

const FINDING_SEVERITY: Record<string, ProposalProblem["severity"] | undefined> = { error: "error", missing: "missing", warning: "warning" };

/**
 * Problems of a proposal: `validateOps` (on the op it names), then, when nothing is an error there, the findings that
 * applying every op to a copy of the head introduces (on the add, update or remove of the finding's subject, else on
 * its only op).
 */
function problemsOf(h: HeadGenome, engine: Op[], ops: ProposedOp[], first: string[]): ProposalProblem[] {
  const problems: ProposalProblem[] = validateOps(engine, h.template, h.graph).map((p) => ({ opId: first[p.op], severity: p.level, message: p.message }));
  if (!ops.length || problems.some((p) => p.severity === "error")) return problems;
  let after: Readiness;
  try {
    const { changes } = applyOps(h.files, ops as TreeOp[]);
    after = evaluate(h.template, readTree(withChanges(h.files, changes), metaTemplates));
  } catch (e) {
    if (e instanceof TreeOpError) return [...problems, { opId: ops[e.op]?.id, severity: "error", message: e.message }];
    if (e instanceof GenomeTreeError) return [...problems, { severity: "error", message: e.message }];
    throw e;
  }
  for (const f of diffFindings(h.readiness, after).appeared) {
    const severity = FINDING_SEVERITY[f.level];
    if (!severity) continue;
    const owners = f.subject === undefined ? [] : ops.filter((o) => o.node === f.subject);
    const owner = owners.find((o) => o.op === "add" || o.op === "update" || o.op === "remove") ?? (owners.length === 1 ? owners[0] : undefined);
    problems.push({ ...(owner && { opId: owner.id }), severity, message: f.message });
  }
  return problems;
}

/** The router's question when the route could not be settled: the options of its first unsettled step. */
function routerQuestion(r: Route, h: HeadGenome): string {
  const step = r.path.find((s) => s.status === "unknown") ?? r.path[r.path.length - 1];
  if (step?.level === "intent") return "Should this add something, change or remove an existing part, relink parts, or is it a question?";
  const byId = new Map(h.graph.nodes.map((n) => [n.id, n]));
  const options = (step?.choices ?? []).filter((c) => c !== ROUTE_NONE && c !== ROUTE_NEW && c !== ROUTE_UNCLEAR).slice(0, 6)
    .map((c) => (byId.has(c) ? `${titleOf(byId.get(c)!, h.template)} (${c})` : c));
  return options.length ? `Which of these is it about: ${options.join("; ")}?` : "Which part of the System should change?";
}

/** One routing and translation of `text` on the head: the proposal's route, ops, question or answer, problems and provenance. */
async function runTurn(env: Env, h: HeadGenome, text: string, questionId: string): Promise<Turn> {
  const { s1, translator } = intentProviders(env);
  const r = await route(h.graph, h.template, text, s1);
  let t: Translation | undefined;
  if (r.status !== "unknown") {
    const slice = routeSlice(h.graph, r);
    t = await translator.translate({ message: text, route: r, slice, vocabulary: routeVocabulary(h.template, r, slice) });
  }
  const engine = t?.ops ?? [];
  const { ops, first } = proposedOps(engine, h.graph, h.template);
  const problems = problemsOf(h, engine, ops, first);
  if (t?.provider === "error") problems.push({ severity: "error", message: `The translator failed: ${t.error ?? "unknown error"}` });
  else if (t?.provider === "off") problems.push({ severity: "warning", message: "No translator is configured, so no changes were proposed." });
  const questions: ProposalQuestion[] = t?.question ? [{ id: questionId, text: t.question }]
    : t ? [] : [{ id: questionId, text: routerQuestion(r, h) }];
  return {
    route: r.path.map((s) => ({ level: s.level, choice: s.answer ?? ROUTE_UNCLEAR, confidence: s.confidence ?? 0 })),
    ops, questions, problems, ...(t?.answer && { answer: t.answer }),
    provenance: {
      router: { provider: r.provenance.provider || s1.mode, model: r.provenance.model, calls: r.calls },
      translator: { provider: t?.provider ?? translator.mode, model: t?.model ?? translator.model },
      genomeCommit: h.state.genomeCommit,
      fake: s1.mode === "fake" || translator.mode === "fake",
    },
  };
}

/** What is routed and translated: the message, the anchor it started from, then each question and answer so far. */
function conversation(h: HeadGenome, message: string, anchor: string | undefined, turns: ProposalTurn[]): string {
  const node = anchor === undefined ? undefined : h.graph.nodes.find((n) => n.id === anchor);
  return [
    message,
    ...(node ? [`(About ${titleOf(node, h.template)} [${node.id}].)`] : []),
    ...turns.flatMap((t) => [...(t.question ? [`Q: ${t.question}`] : []), `A: ${t.answer}`]),
  ].join("\n");
}

const text = (v: unknown, field: string): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > MAX_MESSAGE) throw badRequest(`${field} is required (at most ${MAX_MESSAGE} characters)`);
  return s;
};

// ------------------------------------------------------------------ routes

/** `POST /api/systems/:id/intents`: a new open proposal for `message` on the head Genome. */
export async function createProposal(env: Env, systemId: string, body: Record<string, unknown>): Promise<Proposal> {
  const message = text(body.message, "message");
  if (body.anchor !== undefined && (typeof body.anchor !== "string" || !body.anchor)) throw badRequest("anchor must be a node id");
  const anchor = body.anchor as string | undefined;
  const h = await headGenome(env, systemId);
  if (anchor !== undefined && !h.graph.nodes.some((n) => n.id === anchor)) throw badRequest(`unknown node ${anchor}`);
  const turn = await runTurn(env, h, conversation(h, message, anchor, []), "q.1");
  return systemStub(env, systemId).createProposal({ systemId, message, ...(anchor !== undefined && { anchor }), status: "open", ...turn, createdAt: nowIso() });
}

async function stored(env: Env, systemId: string, pid: string) {
  const s = await systemStub(env, systemId).proposal(pid);
  if (!s) throw notFound(`unknown proposal ${pid}`);
  return s;
}

export async function getProposal(env: Env, systemId: string, pid: string): Promise<Proposal> {
  return (await stored(env, systemId, pid)).proposal;
}

/** `POST …/reply`: route and translate again on the current head with the answer appended; same id, still open. */
export async function replyProposal(env: Env, systemId: string, pid: string, body: Record<string, unknown>): Promise<Proposal> {
  const answer = text(body.answer, "answer");
  if (body.questionId !== undefined && typeof body.questionId !== "string") throw badRequest("questionId must be a string");
  const s = await stored(env, systemId, pid);
  if (s.proposal.status !== "open" || s.accepting) throw conflict("invalid-state", `proposal ${pid} is ${s.accepting ? "being accepted" : s.proposal.status}`);
  const question = body.questionId === undefined ? undefined : s.proposal.questions.find((q) => q.id === body.questionId);
  if (body.questionId !== undefined && !question) throw badRequest(`proposal ${pid} has no open question ${body.questionId}`);
  const turns = [...s.turns, { ...(question && { question: question.text }), answer }];
  const h = await headGenome(env, systemId);
  const turn = await runTurn(env, h, conversation(h, s.proposal.message, s.proposal.anchor, turns), `q.${turns.length + 1}`);
  const { answer: _previous, ...rest } = s.proposal;
  const revised = await systemStub(env, systemId).reviseProposal({ ...rest, ...turn }, turns);
  if (!revised) throw conflict("invalid-state", `proposal ${pid} is no longer open`);
  return revised;
}

/**
 * `POST …/accept`: the chosen ops (each with the ops it depends on, else 422) become a `genome-amendment` Evolution
 * whose affected nodes are the touched nodes, a Genome realization (origin `editor`) and one commit pushed to its fork
 * and submitted as a candidate. The DO first moves the proposal open → accepting while the head is still the
 * proposal's `genomeCommit` (409 `invalid-state` / `stale-base` otherwise), so concurrent accepts cannot both push; a
 * failure after that returns it to open with the error recorded.
 */
export async function acceptProposal(env: Env, systemId: string, pid: string, body: Record<string, unknown>, platformUrl: string): Promise<IntentAcceptResponse> {
  const opIds = body.opIds;
  if (!Array.isArray(opIds) || !opIds.length || opIds.some((x) => typeof x !== "string")) throw badRequest("opIds must be a non-empty array of op ids");
  const stub = systemStub(env, systemId);
  const p = (await stored(env, systemId, pid)).proposal;
  const chosen = new Set(opIds as string[]);
  const unknown = [...chosen].filter((id) => !p.ops.some((o) => o.id === id));
  if (unknown.length) throw badRequest(`proposal ${pid} has no ops ${unknown.join(", ")}`);
  const ops = p.ops.filter((o) => chosen.has(o.id));
  const missing = ops.flatMap((o) => (o.dependsOn ?? []).filter((d) => !chosen.has(d)).map((d) => `${o.id} needs ${d}`));
  if (missing.length) throw unprocessable("missing-dependency", `accept the ops these depend on too: ${missing.join("; ")}`, { missing });

  const claim = await stub.claimProposal(pid);
  if ("refused" in claim) {
    if (claim.refused === "not-found") throw notFound(`unknown proposal ${pid}`);
    if (claim.refused === "stale-base") {
      throw conflict("stale-base", `the Genome moved from ${p.provenance.genomeCommit.slice(0, 12)} to ${claim.currentHead.slice(0, 12)}; describe the change again`,
        { currentHead: claim.currentHead });
    }
    throw conflict("invalid-state", `proposal ${pid} is ${claim.status}`);
  }
  try {
    const out = await pushAccepted(env, systemId, claim.claimed, ops, platformUrl);
    const ids = { evolution: out.evolution.id, realization: out.realization.id, candidate: out.candidate.id, commit: out.commit };
    if (!(await stub.finishProposal(pid, ids))) console.error(`[intents] proposal ${pid} was not accepting when ${out.commit} was committed for it`);
    return out;
  } catch (e) {
    await stub.releaseProposal(pid, (e as Error)?.message ?? String(e)).catch((r: unknown) =>
      console.error(`[intents] releasing proposal ${pid} failed: ${(r as Error)?.message ?? r}`));
    throw e;
  }
}

/** The accept's work once the proposal is claimed: apply, Evolution, Genome realization, commit and candidate. */
async function pushAccepted(env: Env, systemId: string, p: Proposal, ops: ProposedOp[], platformUrl: string): Promise<IntentAcceptResponse> {
  const base = p.provenance.genomeCommit;
  const state = await systemStub(env, systemId).state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const { files } = await genomeAt(env, systemId, base, state.genomeSource);
  let applied;
  try {
    applied = applyOps(files, ops as TreeOp[]);
  } catch (e) {
    if (e instanceof TreeOpError) throw unprocessable("invalid-ops", `${ops[e.op]?.id ?? "an op"} cannot apply: ${e.message.replace(/^op \d+: /, "")}`);
    if (e instanceof GenomeTreeError) throw unprocessable("invalid-ops", e.message);
    throw e;
  }
  if (!applied.changes.length) throw unprocessable("no-change", "the chosen ops change nothing");
  const prefix = await withRepo(artifactsFor(env), state.genomeSource, (r) => genomePrefix(r, base));

  const title = p.message.split("\n")[0]!.trim().slice(0, 200);
  const { evolution } = await createEvolution(env, systemId, { title, intent: p.message, kind: "genome-amendment", affectedNodes: applied.touched },
    { newNodes: ops.filter((o) => o.op === "add").map((o) => o.node) });
  const stub = systemStub(env, systemId);
  try {
    // The fork must start from `base`: the DO refuses the reservation when the head moved after the claim.
    const start = await startWork(env, systemId, evolution.id, { target: "genome", origin: "editor", agentLabel: INTENT_AGENT }, platformUrl, { expectedBase: base });
    const edit = await commitEdit(env, systemId, start.realization.id, {
      message: title, why: p.message,
      changes: applied.changes.map((c) => ({ path: prefix ? `${prefix}/${c.path}` : c.path, content: c.content })),
    }, "intent");
    return {
      evolution: (await stub.evolution(evolution.id)) ?? evolution, realization: edit.submitted.realization,
      candidate: edit.submitted.candidate, commit: edit.commit,
    };
  } catch (e) {
    // Leave nothing a retry would duplicate: the Evolution goes (withdrawn if a realization started) with its work.
    try {
      await revokeEnded(env, systemId, await stub.withdrawEvolution(evolution.id));
      await refreshRegistry(env, systemId);
    } catch (w) {
      console.error(`[intents] withdrawing ${evolution.id} after a failed accept failed: ${(w as Error)?.message ?? w}`);
    }
    if (e instanceof HttpError && e.code === "stale-base") {
      const head = (await stub.state())?.genomeCommit ?? null;
      throw conflict("stale-base", `the Genome moved from ${base.slice(0, 12)} while accepting; describe the change again`, { currentHead: head });
    }
    throw e;
  }
}
