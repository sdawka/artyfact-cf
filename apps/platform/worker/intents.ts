/**
 * Intents: a message about the System becomes a proposal of node updates (route → translate → validate on the head
 * Genome), a reply revises it, and accepting a subset writes those ops to the Genome through an ordinary Genome
 * realization and candidate. Spec: docs/design/ontology.md §4–§6.
 */
import { LegacyGenomeError, loadGenome, ModelParseError, readinessTemplate, type SystemModel } from "@artyfact/model";
import {
  applyOps, diffFindings, evaluate, GenomeTreeError, mintId, parseTree, providerFromEnv, route, ROUTE_NEW, ROUTE_NONE, ROUTE_UNCLEAR, routeSlice, routeVocabulary, titleOf, translatorFromEnv,
  TreeOpError, validateOps, type Graph, type Op, type ProviderEnv, type Readiness, type Route, type SystemOne, type Template,
  type GenomeTree, type Translation, type Translator, type TranslatorEnv, type TreeOp,
} from "@artyfact/ontology";
import { metaTemplates } from "@artyfact/templates";
import { demoModels, isHostedDemo } from "./demo";
import type {
  IntentAcceptResponse, IntentDecisionsRequest, Proposal, ProposalDecision, ProposalDecisions, ProposalPlanNode, ProposalProblem, ProposalQuestion, ProposedOp,
} from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { genomePrefix } from "./artifacts/genome-source";
import type { HeadState } from "./do/system-authority";
import { MAX_TURNS, type ProposalTurn, type StoredProposal } from "./do/proposals-store";
import { commitEdit } from "./editor";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { accept as approveGenome, createEvolution, genomeAt, refreshRegistry, registryStub, revokeEnded, startWork, systemStub } from "./service";
import { nowIso } from "./util";

/** The agent label of an intent's Genome realization; its commits are authored as `intent`. */
export const INTENT_AGENT = "human:intent";
const MAX_MESSAGE = 4000;
export { MAX_TURNS };

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
  if (isHostedDemo(env)) return { ...demoModels(), ...override };
  return {
    s1: override.s1 ?? providerFromEnv(env as unknown as ProviderEnv),
    translator: override.translator ?? translatorFromEnv(env as unknown as TranslatorEnv),
  };
}

// ------------------------------------------------------------------ head Genome

/** A Genome commit as intents judge it: its files, projected graph, readiness template and findings, and node tree. */
interface GenomeAt { files: Map<string, string>; graph: Graph; template: Template; readiness: Readiness; tree: GenomeTree }
interface HeadGenome extends GenomeAt { state: HeadState }

/** The head as the model projects it (`loadGenome`); a v1 or unreadable Genome is 422. */
function projected(files: Map<string, string>): SystemModel {
  try {
    return loadGenome(files, { templates: metaTemplates });
  } catch (e) {
    if (e instanceof LegacyGenomeError) throw unprocessable("legacy-genome", e.message);
    if (e instanceof ModelParseError) throw unprocessable(e.code, e.message);
    throw e;
  }
}

/**
 * The engine's view of a v2 Genome, as platform readiness sees it: the projected graph, the System template composed
 * with its Things' (each instantiated for its Thing) running the packs the System pins, and its readiness, which
 * proposals are compared against.
 */
export function genomeGraph(files: Map<string, string>): { graph: Graph; template: Template; readiness: Readiness } {
  const m = projected(files);
  const template = readinessTemplate(m);
  return { graph: m.graph, template, readiness: evaluate(template, m.graph) };
}

const memo = new Map<string, Omit<GenomeAt, "files">>();
const MEMO_MAX = 8;

/** The System's Genome at `commit` (memoized by commit). */
async function genomeOf(env: Env, systemId: string, state: HeadState, commit: string): Promise<GenomeAt> {
  const { files } = await genomeAt(env, systemId, commit, state.genomeSource);
  const key = `${systemId}@${commit}`;
  let g = memo.get(key);
  if (!g) {
    g = { ...genomeGraph(files), tree: parseTree(files) };
    memo.set(key, g);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  }
  return { files, ...g };
}

async function headGenome(env: Env, systemId: string): Promise<HeadGenome> {
  const state = await systemStub(env, systemId).state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  return { state, ...(await genomeOf(env, systemId, state, state.genomeCommit)) };
}

// ------------------------------------------------------------------ one turn: route → translate → validate

type Turn = Pick<Proposal, "route" | "ops" | "questions" | "problems" | "answer" | "provenance" | "plan">;

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

// ------------------------------------------------------------------ the agreement plan (docs/design/ontology.md §5)

/** The trailing node holding ops whose node is in neither the tree nor the proposal's adds. */
export const OTHER_NODE = "other";
const OP_ORDER = ["add", "update", "remove", "link", "unlink"];

/** One line per subtree: `2 add · 1 update`, in OP_ORDER then any other op kinds. */
function summaryOf(ops: ProposedOp[]): string {
  const counts = new Map<string, number>();
  for (const o of ops) counts.set(o.op, (counts.get(o.op) ?? 0) + 1);
  const kinds = [...OP_ORDER.filter((k) => counts.has(k)), ...[...counts.keys()].filter((k) => !OP_ORDER.includes(k))];
  return kinds.map((k) => `${counts.get(k)} ${k}`).join(" · ");
}

const fieldTitle = (fields: Record<string, unknown> | undefined): string | undefined => {
  const t = fields?.title ?? fields?.name;
  return typeof t === "string" && t.trim() ? t.trim() : undefined;
};

/**
 * The agreement tree of `ops` over the Genome `tree` they were proposed on. Each op belongs to one node: an `add` to
 * the node it mints (placed under its `parent`, else the System root), a `link`/`unlink` to its `from` node, any other
 * op to the node it names. The tree is rooted at Things (kind `thing`), or at the System root for a node outside every
 * Thing; the nodes between a root and an op's node are kept (with no ops of their own) so the tree follows the
 * Genome's containment. `path` is the ancestor chain from the System root down to and including the node. Ops whose
 * node is unknown go under a trailing `other` node (path `[]`). Every op id is in exactly one node's `opIds`; `summary`
 * counts the ops of the node's subtree. `title` names a node (default: its, or its add's, `title`/`name`, else its id).
 */
export function planOf(ops: ProposedOp[], tree: GenomeTree, title?: (id: string) => string | undefined): ProposalPlanNode[] {
  const adds = new Map(ops.filter((o) => o.op === "add").map((o) => [o.node, o] as const));
  const chains = new Map<string, string[] | null>();
  /** Root-first ids from the System root to `id` (inclusive), or null when `id` is unknown. */
  const chain = (id: string, seen = new Set<string>()): string[] | null => {
    if (chains.has(id)) return chains.get(id)!;
    let out: string[] | null = null;
    if (tree.nodes.has(id)) {
      out = [];
      for (let at: string | undefined = id; at !== undefined; at = tree.nodes.get(at)?.parent) out.unshift(at);
    } else if (adds.has(id) && !seen.has(id)) {
      seen.add(id);
      const up = chain(adds.get(id)!.parent ?? tree.root, seen);
      out = up && [...up, id];
    }
    chains.set(id, out);
    return out;
  };
  const kindOf = (id: string) => tree.nodes.get(id)?.file.kind ?? adds.get(id)?.kind ?? "node";
  const titleFor = (id: string) => {
    const add = adds.get(id);
    return title?.(id) ?? fieldTitle(add ? add.fields : tree.nodes.get(id)?.file.fields) ?? id;
  };

  interface Draft { node: ProposalPlanNode; ops: ProposedOp[] }
  const drafts = new Map<string, Draft>();
  const roots: Draft[] = [];
  const draft = (ids: string[], i: number): Draft => {
    const id = ids[i]!;
    let d = drafts.get(id);
    if (!d) {
      d = { node: { id, kind: kindOf(id), title: titleFor(id), path: ids.slice(0, i + 1), summary: "", opIds: [], children: [] }, ops: [] };
      drafts.set(id, d);
    }
    return d;
  };
  const other: Draft = { node: { id: OTHER_NODE, kind: "other", title: "Other changes", path: [], summary: "", opIds: [], children: [] }, ops: [] };
  for (const op of ops) {
    const ids = chain(op.node);
    if (!ids) {
      other.node.opIds.push(op.id);
      other.ops.push(op);
      continue;
    }
    const thing = ids.findIndex((id) => kindOf(id) === "thing");
    let parent: Draft | undefined;
    for (let i = thing === -1 ? 0 : thing; i < ids.length; i++) {
      const known = drafts.has(ids[i]!);
      const d = draft(ids, i);
      if (!known) {
        if (parent) parent.node.children.push(d.node);
        else roots.push(d);
      }
      d.ops.push(op);
      parent = d;
    }
    parent!.node.opIds.push(op.id);
  }
  for (const d of drafts.values()) d.node.summary = summaryOf(d.ops);
  other.node.summary = summaryOf(other.ops);
  return [...roots.map((r) => r.node), ...(other.ops.length ? [other.node] : [])];
}

/** Every node of `plan`, depth first, with its parent's id. */
function* walkPlan(plan: ProposalPlanNode[], parent?: string): Generator<{ node: ProposalPlanNode; parent?: string }> {
  for (const n of plan) {
    yield { node: n, ...(parent !== undefined && { parent }) };
    yield* walkPlan(n.children, n.id);
  }
}

const planIds = (plan: ProposalPlanNode[]) => new Set([...walkPlan(plan)].map((x) => x.node.id));

/** `plan` with each node's explicit decision from `decisions` (an id the plan no longer has is ignored). */
export function withDecisions(plan: ProposalPlanNode[], decisions: ProposalDecisions): ProposalPlanNode[] {
  return plan.map((n) => {
    const { decision: _old, ...rest } = n;
    const d = decisions[n.id];
    return { ...rest, ...(d && { decision: d }), children: withDecisions(n.children, decisions) };
  });
}

/**
 * The decisions after `changes`, applied in order: a decision on a node clears the explicit decisions of all its
 * descendants, `null` clears the node's own. An id the plan lacks is a 404.
 */
export function applyDecisions(plan: ProposalPlanNode[], decisions: ProposalDecisions, changes: IntentDecisionsRequest["decisions"]): ProposalDecisions {
  const byId = new Map([...walkPlan(plan)].map((x) => [x.node.id, x.node] as const));
  const out = { ...decisions };
  for (const c of changes) {
    const node = byId.get(c.nodeId);
    if (!node) throw notFound(`the plan has no node ${c.nodeId}`);
    if (c.decision === null) {
      delete out[c.nodeId];
      continue;
    }
    for (const d of walkPlan(node.children)) delete out[d.node.id];
    out[c.nodeId] = c.decision;
  }
  return out;
}

/** Each node's effective decision: its own (an explicit child decision overrides the inherited one), else its nearest decided ancestor's, else none. */
export function effectiveDecisions(plan: ProposalPlanNode[], decisions: ProposalDecisions): Map<string, ProposalDecision | undefined> {
  const out = new Map<string, ProposalDecision | undefined>();
  for (const { node, parent } of walkPlan(plan)) out.set(node.id, decisions[node.id] ?? (parent === undefined ? undefined : out.get(parent)));
  return out;
}

/**
 * The ops of `plan` by effective decision, and the explicitly deferred nodes that hold deferred ops (topmost first).
 * Undecided ops are in none of the sets.
 */
export function opsByDecision(plan: ProposalPlanNode[], decisions: ProposalDecisions) {
  const eff = effectiveDecisions(plan, decisions);
  const agreed = new Set<string>();
  const rejected = new Set<string>();
  const deferred = new Set<string>();
  const deferredNodes: string[] = [];
  for (const { node, parent } of walkPlan(plan)) {
    const d = eff.get(node.id);
    const into = d === "agree" ? agreed : d === "reject" ? rejected : d === "defer" ? deferred : undefined;
    for (const id of node.opIds) into?.add(id);
    if (decisions[node.id] === "defer" && (parent === undefined || eff.get(parent) !== "defer")) deferredNodes.push(node.id);
  }
  const holding = (n: ProposalPlanNode): boolean => n.opIds.length > 0 || n.children.some(holding);
  const byId = new Map([...walkPlan(plan)].map((x) => [x.node.id, x.node] as const));
  return { agreed, rejected, deferred, deferredNodes: deferredNodes.filter((id) => holding(byId.get(id)!)) };
}

/** `decisions` kept only on nodes `plan` has. */
function prune(decisions: ProposalDecisions, plan: ProposalPlanNode[]): ProposalDecisions {
  const ids = planIds(plan);
  return Object.fromEntries(Object.entries(decisions).filter(([id]) => ids.has(id))) as ProposalDecisions;
}

/** Canonical form of decisions, to compare two sets. */
const decisionKey = (d: ProposalDecisions) => JSON.stringify(Object.entries(d).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

async function decisionsOf(env: Env, systemId: string, pid: string): Promise<ProposalDecisions> {
  return (await systemStub(env, systemId).proposalPlan(pid))?.decisions ?? {};
}

/** The wire proposal: its plan (`[]` for one stored before plans) with the explicit decisions on its nodes. */
function onWire(p: Proposal, decisions: ProposalDecisions = {}): Proposal {
  return { ...p, plan: withDecisions(Array.isArray(p.plan) ? p.plan : [], decisions) };
}

/** The plan of `ops` on the Genome at `commit`, titled as that Genome shows them. */
async function planOn(env: Env, systemId: string, ops: ProposedOp[], commit: string): Promise<ProposalPlanNode[]> {
  const state = await systemStub(env, systemId).state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const g = await genomeOf(env, systemId, state, commit);
  return planOf(ops, g.tree, titles(g, ops));
}

/** Plan titles as a Genome shows them: an existing node's title (titleOf), an add's under its kind's name field. */
function titles(h: { graph: Graph; template: Template }, ops: ProposedOp[]): (id: string) => string | undefined {
  const byId = new Map(h.graph.nodes.map((n) => [n.id, n]));
  return (id) => {
    const n = byId.get(id);
    if (n) return titleOf(n, h.template);
    const add = ops.find((o) => o.op === "add" && o.node === id);
    const t = add?.kind === undefined ? undefined : add.fields?.[titleField(h.template, add.kind)];
    return typeof t === "string" && t.trim() ? t.trim() : undefined;
  };
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
    after = evaluate(h.template, loadGenome(withChanges(h.files, changes), { templates: metaTemplates }).graph);
  } catch (e) {
    if (e instanceof TreeOpError) return [...problems, { opId: ops[e.op]?.id, severity: "error", message: e.message }];
    if (e instanceof ModelParseError) return [...problems, { severity: "error", message: e.message }];
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
  const plan = planOf(ops, h.tree, titles(h, ops));
  if (t?.provider === "error") problems.push({ severity: "error", message: `The translator failed: ${t.error ?? "unknown error"}` });
  else if (t?.provider === "off") problems.push({ severity: "warning", message: "No translator is configured, so no changes were proposed." });
  const questions: ProposalQuestion[] = t?.question ? [{ id: questionId, text: t.question }]
    : t ? [] : [{ id: questionId, text: routerQuestion(r, h) }];
  return {
    route: r.path.map((s) => ({ level: s.level, choice: s.answer ?? ROUTE_UNCLEAR, confidence: s.confidence ?? 0 })),
    ops, plan, questions, problems, ...(t?.answer && { answer: t.answer }),
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
  const {evolution}=await createEvolution(env,systemId,{title:message.split('\n')[0]!.slice(0,200),intent:message,kind:'genome-amendment'});
  return systemStub(env, systemId).createProposal({ evolutionId:evolution.id,systemId, message, ...(anchor !== undefined && { anchor }), status: "open", ...turn, createdAt: nowIso() });
}

async function stored(env: Env, systemId: string, pid: string) {
  const s = await systemStub(env, systemId).proposal(pid);
  if (!s) throw notFound(`unknown proposal ${pid}`);
  return s;
}

export async function getProposal(env: Env, systemId: string, pid: string): Promise<Proposal> {
  return onWire((await stored(env, systemId, pid)).proposal, await decisionsOf(env, systemId, pid));
}

/**
 * `PUT …/decisions`: the admin's decisions on plan nodes, applied in order (see applyDecisions) and stored in one
 * write while the proposal is open (409 `invalid-state` otherwise, or while it holds a staged Genome candidate; 404 for
 * a node the plan lacks). The write carries the tree read here, so when a reply lands between the read and the write
 * its rebuilt tree is restored from the stored revision, with the decisions kept on the nodes it still has.
 */
export async function decideProposal(env: Env, systemId: string, pid: string, body: Record<string, unknown>): Promise<Proposal> {
  const changes = body.decisions;
  const valid = (c: unknown) => {
    const x = c as Record<string, unknown> | null;
    return typeof x === "object" && x !== null && typeof x.nodeId === "string" && x.nodeId !== ""
      && (x.decision === null || x.decision === "agree" || x.decision === "reject" || x.decision === "defer");
  };
  if (!Array.isArray(changes) || !changes.length || !changes.every(valid)) {
    throw badRequest("decisions must be a non-empty array of {nodeId, decision: agree | reject | defer | null}");
  }
  const stub = systemStub(env, systemId);
  for (let attempt = 1; ; attempt++) {
    const s = await stored(env, systemId, pid);
    if (s.proposal.status !== "open" || s.accepting) throw conflict("invalid-state", `proposal ${pid} is ${s.accepting ? "being accepted" : s.proposal.status}`);
    if (s.proposal.stagedApproval) throw conflict("invalid-state", `proposal ${pid} already has an exact staged Genome candidate; approve or abandon it before changing decisions`);
    const plan = onWire(s.proposal).plan;
    const before = await decisionsOf(env, systemId, pid);
    const decisions = applyDecisions(plan, before, changes as IntentDecisionsRequest["decisions"]);
    // Compare-and-set on the decisions read: a concurrent PUT that landed meanwhile makes this re-read and re-apply.
    if (!(await stub.setProposalPlan(pid, plan, decisions, undefined, before))) {
      if (attempt < CAS_ATTEMPTS) continue;
      throw conflict("invalid-state", `the decisions of proposal ${pid} kept changing; read it and decide again`);
    }
    const after = await stub.proposal(pid);
    if (after && after.turns.length !== s.turns.length) return onWire(...(await repairAfterReply(env, systemId, pid, after, decisions)));
    return onWire(s.proposal, decisions);
  }
}

/**
 * A reply landed while a PUT wrote its decisions: rebuild the tree of the reply's ops and prune the decisions to it, by
 * compare-and-set. A PUT or another reply that lands meanwhile is re-read (and the tree rebuilt again for a newer reply),
 * so neither is overwritten; after {@link CAS_ATTEMPTS} losses whatever landed stands.
 */
async function repairAfterReply(env: Env, systemId: string, pid: string, after: StoredProposal, decisions: ProposalDecisions): Promise<[Proposal, ProposalDecisions]> {
  const stub = systemStub(env, systemId);
  let expected = decisions;
  for (let attempt = 1; ; attempt++) {
    const rebuilt = await planOn(env, systemId, after.proposal.ops, after.proposal.provenance.genomeCommit);
    const kept = prune(expected, rebuilt);
    if (await stub.setProposalPlan(pid, rebuilt, kept, undefined, expected)) return [{ ...after.proposal, plan: rebuilt }, kept];
    const next = await stub.proposal(pid);
    expected = await decisionsOf(env, systemId, pid);
    if (attempt >= CAS_ATTEMPTS || !next || next.proposal.status !== "open") return [{ ...after.proposal, plan: rebuilt }, prune(expected, rebuilt)];
    after = next;
  }
}

/** Tries of a decisions compare-and-set before giving up (a PUT answers 409; a reply's prune leaves them). */
const CAS_ATTEMPTS = 3;

/** `POST …/reply`: route and translate again on the current head with the answer appended; same id, still open. */
export async function replyProposal(env: Env, systemId: string, pid: string, body: Record<string, unknown>): Promise<Proposal> {
  const answer = text(body.answer, "answer");
  if (body.questionId !== undefined && typeof body.questionId !== "string") throw badRequest("questionId must be a string");
  const s = await stored(env, systemId, pid);
  if (s.proposal.status !== "open" || s.accepting) throw conflict("invalid-state", `proposal ${pid} is ${s.accepting ? "being accepted" : s.proposal.status}`);
  // A fast path only: the DO enforces the cap where the turn is appended (reviseProposal), as one conditional write.
  if (s.turns.length >= MAX_TURNS) throw tooManyTurns(pid);
  const question = body.questionId === undefined ? undefined : s.proposal.questions.find((q) => q.id === body.questionId);
  if (body.questionId !== undefined && !question) throw badRequest(`proposal ${pid} has no open question ${body.questionId}`);
  if(s.proposal.stagedApproval)throw conflict('invalid-state','This proposal already has an exact staged Genome candidate; approve or abandon it before revising');
  const turns = [...s.turns, { ...(question && { question: question.text }), answer }];
  const h = await headGenome(env, systemId);
  const turn = await runTurn(env, h, conversation(h, s.proposal.message, s.proposal.anchor, turns), `q.${turns.length + 1}`);
  const { answer: _previous, ...rest } = s.proposal;
  // The revision carries the ops and the head they were translated on together, so a deferred proposal rebased
  // meanwhile is never paired with ops from another base; its tree is rebuilt here and its decisions are kept.
  const r = await systemStub(env, systemId).reviseProposal({ ...rest, ...turn }, turns);
  if ("revised" in r) return onWire(r.revised, await prunedDecisions(env, systemId, r.revised));
  if (r.refused === "too-many-turns") throw tooManyTurns(pid);
  if (r.refused === "changed") throw conflict("invalid-state", `another reply to proposal ${pid} landed first; read it and reply again`);
  if (r.refused === "staged") throw conflict("invalid-state", `an accept staged a Genome candidate for proposal ${pid} meanwhile; approve or abandon it before revising`);
  throw conflict("invalid-state", `proposal ${pid} is no longer open`);
}

/**
 * The decisions of a revised proposal, kept only on nodes its rebuilt plan still has: a decision on a node the reply
 * dropped would otherwise switch on strict accepts (chosenByPlan) for ops nobody decided.
 */
async function prunedDecisions(env: Env, systemId: string, p: Proposal): Promise<ProposalDecisions> {
  let decisions: ProposalDecisions = {};
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    decisions = await decisionsOf(env, systemId, p.id);
    const kept = prune(decisions, p.plan);
    if (Object.keys(kept).length === Object.keys(decisions).length) return decisions;
    // Compare-and-set: a decisions PUT that landed meanwhile is re-read and pruned, never overwritten.
    if (await systemStub(env, systemId).setProposalPlan(p.id, p.plan, kept, undefined, decisions)) return kept;
  }
  // Still changing (or no longer open): whatever landed stands; the next read prunes nothing it should not.
  return decisions;
}

const tooManyTurns = (pid: string) =>
  unprocessable("too-many-turns", `proposal ${pid} already has ${MAX_TURNS} replies; describe the change again as a new intent`);

/** The chosen ops of `p`, in proposal order: 400 for an id it lacks, 422 `missing-dependency` for an op without its `dependsOn`. */
function chosenOps(p: Proposal, opIds: string[]): ProposedOp[] {
  const chosen = new Set(opIds);
  const unknown = [...chosen].filter((id) => !p.ops.some((o) => o.id === id));
  if (unknown.length) throw badRequest(`proposal ${p.id} has no ops ${unknown.join(", ")}`);
  const ops = p.ops.filter((o) => chosen.has(o.id));
  const missing = ops.flatMap((o) => (o.dependsOn ?? []).filter((d) => !chosen.has(d)).map((d) => `${o.id} needs ${d}`));
  if (missing.length) throw unprocessable("missing-dependency", `accept the ops these depend on too: ${missing.join("; ")}`, { missing });
  return ops;
}

/** The ops an accept defers: the effectively deferred ops of the plan, and the deferred nodes holding them. */
interface DeferredOps { ops: ProposedOp[]; nodeIds: string[]; titles: string[] }

/** What the plan decides for an accept: the ops applied now, those moved to a deferred proposal, those dropped. */
interface PlanChoice { ops: ProposedOp[]; deferred?: DeferredOps; dropped: string[] }

/**
 * The chosen ops of `p` under its plan decisions. With no decisions at all, any ops may be chosen (as before plans),
 * nothing is deferred and the rest are dropped. Once any node is decided, the chosen ops must all be under
 * effectively agreed nodes (else 422 `invalid-ops` naming them), and the unchosen ops are split:
 * - effectively deferred ops move to a new proposal;
 * - an unchosen agreed op follows a deferred dependency there (directly or through other unchosen ops) when every
 *   dependency it has is chosen or moving (a blocked agreed op);
 * - a moving op is kept only while each of its dependencies is chosen (applied now) or moving too; otherwise it is
 *   dropped, and so are the moving ops that depend on it, so a deferred proposal never carries an op without the
 *   dependency it was proposed with;
 * - every other op (rejected, undecided, agreed but left out, or dropped above) is dropped and reported.
 * `deferred.nodeIds` are the deferred proposal's topmost nodes: the explicitly deferred nodes holding moving ops, and
 * the nodes of moved agreed ops outside them.
 */
function chosenByPlan(p: Proposal, opIds: string[], decisions: ProposalDecisions): PlanChoice {
  if (!Object.keys(decisions).length) {
    const ops = chosenOps(p, opIds);
    return { ops, dropped: p.ops.filter((o) => !ops.includes(o)).map((o) => o.id) };
  }
  const unknown = opIds.filter((id) => !p.ops.some((o) => o.id === id));
  if (unknown.length) throw badRequest(`proposal ${p.id} has no ops ${unknown.join(", ")}`);
  const plan = onWire(p).plan;
  const by = opsByDecision(plan, decisions);
  const offenders = [...new Set(opIds)].filter((id) => !by.agreed.has(id));
  if (offenders.length) throw unprocessable("invalid-ops", `only ops under agreed nodes can be accepted: ${offenders.join(", ")}`, { offenders });
  const ops = chosenOps(p, opIds);
  const chosen = new Set(opIds);
  const moving = new Set(by.deferred);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of p.ops) {
      if (moving.has(o.id) || chosen.has(o.id) || !by.agreed.has(o.id) || !o.dependsOn?.length) continue;
      if (o.dependsOn.some((d) => moving.has(d)) && o.dependsOn.every((d) => moving.has(d) || chosen.has(d))) {
        moving.add(o.id);
        grew = true;
      }
    }
  }
  for (let shrank = true; shrank;) {
    shrank = false;
    for (const o of p.ops) {
      if (moving.has(o.id) && (o.dependsOn ?? []).some((d) => !moving.has(d) && !chosen.has(d))) {
        moving.delete(o.id);
        shrank = true;
      }
    }
  }
  const dropped = p.ops.filter((o) => !chosen.has(o.id) && !moving.has(o.id)).map((o) => o.id);
  const deferredOps = p.ops.filter((o) => moving.has(o.id));
  if (!deferredOps.length) return { ops, dropped };
  const nodes = [...walkPlan(plan)].map((x) => x.node);
  const holder = new Map(nodes.flatMap((n) => n.opIds.map((id) => [id, n] as const)));
  const nodeIds: string[] = [];
  for (const o of deferredOps) {
    const n = holder.get(o.id);
    if (!n) continue;
    const top = by.deferredNodes.find((d) => n.path.includes(d) || n.id === d) ?? n.id;
    if (!nodeIds.includes(top)) nodeIds.push(top);
  }
  const titleOfNode = new Map(nodes.map((n) => [n.id, n.title] as const));
  return { ops, dropped, deferred: { ops: deferredOps, nodeIds, titles: nodeIds.map((id) => titleOfNode.get(id) ?? id) } };
}

/** The deferred proposal's message: its scope first (also its Evolution's title), then the original request as context. */
export function deferredMessage(from: string, titles: string[], original: string): string {
  const head = `Deferred from ${from}: ${titles.join(", ")}`.slice(0, 200);
  const context = `\n\nContext, the original request (its other parts were decided in ${from}):\n`;
  return head + context + original.slice(0, Math.max(0, MAX_MESSAGE - head.length - context.length));
}

/**
 * The new open proposal holding an accept's deferred ops, with its own linked Genome Evolution: same System, route
 * and provenance (so the accepted proposal's base Genome, which rebaseDeferred moves to the head at its accept), a
 * scoped message (deferredMessage; a reply re-translates against that scope, with the original only as context, and
 * no anchor), the deferred ops (dependencies on ops accepted now are dropped; chosenByPlan keeps no other outside
 * dependency), their problems, a plan rebuilt over them on that base, no decisions, `deferredFrom` the accepted
 * proposal. The Evolution is discarded (and the registry refreshed) if the proposal cannot be stored.
 */
async function deferProposal(env: Env, systemId: string, p: Proposal, d: DeferredOps): Promise<Proposal> {
  const keep = new Set(d.ops.map((o) => o.id));
  const ops = d.ops.map((o) => {
    if (!o.dependsOn) return o;
    const { dependsOn, ...rest } = o;
    const kept = dependsOn.filter((x) => keep.has(x));
    return kept.length ? { ...rest, dependsOn: kept } : rest;
  });
  const plan = await planOn(env, systemId, ops, p.provenance.genomeCommit);
  const stub = systemStub(env, systemId);
  const message = deferredMessage(p.id, d.titles, p.message);
  const { evolution } = await createEvolution(env, systemId, { title: message.split("\n")[0]!, intent: message, kind: "genome-amendment" });
  const { id: _id, answer: _answer, anchor: _anchor, deferredFrom: _from, stagedApproval: _staged, evolutionId: _evolution, ...base } = p;
  try {
    return await stub.createProposal({
      ...base, message, evolutionId: evolution.id, status: "open", ops, questions: [], problems: p.problems.filter((x) => x.opId !== undefined && keep.has(x.opId)),
      plan, deferredFrom: p.id, createdAt: nowIso(),
    });
  } catch (e) {
    try {
      await stub.discardEvolution(evolution.id);
      await refreshRegistry(env, systemId);
    } catch (w) {
      console.error(`[intents] discarding ${evolution.id} after a failed deferral failed: ${(w as Error)?.message ?? w}`);
    }
    throw e;
  }
}

/**
 * A deferred proposal keeps the base of the proposal it came from, and that accept moved the head when it approved
 * the Genome candidate, so every deferred accept starts here. Before the claim, an open deferred proposal behind the
 * head is re-validated: its chosen ops (with their dependencies) are applied to the head Genome, and when they still
 * apply its base moves to the head (DO `rebaseProposal`), so the claim and the push work on the head. When they no
 * longer apply (an unknown node, a conflicting state), or the proposal holds a staged candidate built on its old base,
 * the accept is a 409 `stale-base`. Any other proposal, or one already on the head, is left for the claim to judge.
 */
async function rebaseDeferred(env: Env, systemId: string, pid: string, opIds: string[]): Promise<void> {
  const stub = systemStub(env, systemId);
  const s = await stub.proposal(pid);
  if (!s || s.accepting || s.proposal.status !== "open" || !s.proposal.deferredFrom) return;
  const base = s.proposal.provenance.genomeCommit;
  const h = await headGenome(env, systemId);
  const head = h.state.genomeCommit;
  if (base === head) return;
  if (s.proposal.stagedApproval) {
    throw conflict("stale-base", `the Genome moved to ${head.slice(0, 12)} after this proposal's candidate was staged on ${base.slice(0, 12)}; describe the change again`,
      { currentHead: head });
  }
  const ops = chosenOps(s.proposal, opIds);
  try {
    applyOps(h.files, ops as TreeOp[]);
  } catch (e) {
    if (!(e instanceof TreeOpError) && !(e instanceof GenomeTreeError)) throw e;
    const why = e instanceof TreeOpError ? `${ops[e.op]?.id ?? "an op"} ${e.message.replace(/^op \d+: /, "")}` : e.message;
    throw conflict("stale-base", `the Genome moved to ${head.slice(0, 12)} since these ops were deferred and they no longer apply (${why}); describe the change again`,
      { currentHead: head });
  }
  // False when another accept, a staging or a head move got there first: the claim then says why.
  if (!(await stub.rebaseProposal(pid, base, head))) return;
  // The plan follows the base: rebuilt on the head (titles, paths, adds whose parent now exists), decisions pruned to
  // it. Best effort: a decisions PUT that lands meanwhile keeps its own. The stored problems stay those of the base.
  const decisions = await decisionsOf(env, systemId, pid);
  const plan = planOf(s.proposal.ops, h.tree, titles(h, s.proposal.ops));
  await stub.setProposalPlan(pid, plan, prune(decisions, plan), undefined, decisions);
}

/**
 * `POST …/accept`: the chosen ops (each with the ops it depends on, else 422) become a `genome-amendment` Evolution
 * whose affected nodes are the touched nodes, a Genome realization (origin `editor`) and one commit pushed to its fork
 * and submitted as a candidate. The DO first moves the proposal open → accepting while the head is still the
 * proposal's `genomeCommit` (409 `invalid-state` / `stale-base` otherwise), so concurrent accepts cannot both push.
 * A deferred proposal behind the head is first moved onto it when its ops still apply there (rebaseDeferred).
 * The op ids are checked against the revision the claim returned, never an earlier read, since a reply re-mints them,
 * and against its plan decisions (chosenByPlan). A staged candidate is approved only for the op selection and the
 * decisions it was staged under. Once approved, the deferred ops move to a new open proposal (deferProposal).
 * A failure before the push returns the proposal to open with the error recorded; once the commit is pushed it is
 * never reopened.
 */
export async function acceptProposal(env: Env, systemId: string, pid: string, body: Record<string, unknown>, platformUrl: string): Promise<IntentAcceptResponse> {
  const opIds = body.opIds;
  if (!Array.isArray(opIds) || !opIds.length || opIds.some((x) => typeof x !== "string")) throw badRequest("opIds must be a non-empty array of op ids");
  await rebaseDeferred(env, systemId, pid, opIds as string[]);
  const stub = systemStub(env, systemId);
  const claim = await stub.claimProposal(pid);
  if ("refused" in claim) {
    if (claim.refused === "not-found") throw notFound(`unknown proposal ${pid}`);
    if (claim.refused === "stale-base") {
      throw conflict("stale-base", `the Genome moved to ${claim.currentHead.slice(0, 12)} since this proposal was made; describe the change again`,
        { currentHead: claim.currentHead });
    }
    throw conflict("invalid-state", `proposal ${pid} is ${claim.status}`);
  }
  let out: IntentAcceptResponse;
  let deferred: DeferredOps | undefined;
  let dropped: string[] = [];
  let pushed=false,staged=!!claim.claimed.stagedApproval;
  try {
    // Decisions are written only while the proposal is open, so the claim fixes them.
    const decisions = await decisionsOf(env, systemId, pid);
    let ops: ProposedOp[];
    ({ ops, deferred, dropped } = chosenByPlan(claim.claimed, opIds as string[], decisions));
    const previous=claim.claimed.stagedApproval;
    if(previous){
      if(JSON.stringify([...previous.opIds].sort())!==JSON.stringify([...(opIds as string[])].sort()))throw conflict('invalid-state','The staged candidate pins the previously reviewed op selection');
      if(decisionKey(previous.decisions ?? {}) !== decisionKey(decisions)) throw conflict("invalid-state", "the plan decisions changed since the Genome candidate was staged; restore them or abandon the candidate");
      const [evolution,record,candidate]=await Promise.all([stub.evolution(previous.evolutionId),stub.realization(previous.realizationId),stub.candidate(previous.candidateId)]);
      if(!evolution||!record||!candidate)throw conflict('invalid-state','staged approval records are unavailable');
      out={evolution,realization:record.realization,candidate,commit:previous.commit};
    }else{
      out=await pushAccepted(env,systemId,claim.claimed,ops,platformUrl);pushed=true;
      const approval: NonNullable<Proposal["stagedApproval"]> = {evolutionId:out.evolution.id,realizationId:out.realization.id,candidateId:out.candidate.id,commit:out.commit,opIds:opIds as string[],decisions};
      staged=await stub.stageProposal(pid,claim.claimedAt,approval);
      if(!staged)throw conflict('invalid-state','Genome candidate pushed but approval claim changed; inspect the exact candidate before retrying');
    }
    const approved=await approveGenome(env,systemId,out.evolution.id,{realizationId:out.realization.id,candidateId:out.candidate.id,commit:out.commit,interpretation:claim.claimed.message});
    out={...out,systemCommit:approved.commit,evolution:(await stub.evolution(out.evolution.id))??out.evolution,realization:approved.realization,candidate:(await stub.candidate(out.candidate.id))??out.candidate};
  }catch(e){
    if(!pushed||staged)await stub.releaseProposal(pid,claim.claimedAt,!pushed&&!staged&&e instanceof HttpError&&[400,422].includes(e.status)?null:(e as Error)?.message??String(e));
    throw e;
  }
  // Pushed: the proposal is accepted whatever happens next, so a retry can never push the change twice.
  const ids = { evolution: out.evolution.id, realization: out.realization.id, candidate: out.candidate.id, commit: out.commit };
  let deferError: string | undefined;
  if (dropped.length) out = { ...out, dropped };
  if (deferred) {
    try {
      out = { ...out, deferred: { proposal: (await deferProposal(env, systemId, claim.claimed, deferred)).id, nodeIds: deferred.nodeIds } };
    } catch (e) {
      deferError = `moving the deferred ops ${deferred.ops.map((o) => o.id).join(", ")} to a new proposal failed: ${(e as Error)?.message ?? e}`;
      console.error(`[intents] ${pid}: ${deferError}`);
      out = { ...out, deferralError: deferError };
    }
  }
  try {
    if (!(await stub.finishProposal(pid, claim.claimedAt, ids, deferError))) console.error(`[intents] proposal ${pid} was no longer held by this accept when ${out.commit} was committed for it`);
  } catch (e) {
    const error = [deferError, `recording the accept failed after ${out.commit} was pushed: ${(e as Error)?.message ?? e}`].filter(Boolean).join("; ");
    console.error(`[intents] ${pid}: ${error}`);
    // Left `accepting` (a 409 to any retry) if this fails too.
    await stub.finishProposal(pid, claim.claimedAt, ids, error).catch((r: unknown) =>
      console.error(`[intents] proposal ${pid} stays accepting: ${(r as Error)?.message ?? r}`));
  }
  return out;
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
  const linked=p.evolutionId?await systemStub(env,systemId).evolution(p.evolutionId):null;
  const evolution=linked?await systemStub(env,systemId).setEvolutionAffectedNodes(linked.id,applied.touched):(await createEvolution(env, systemId, { title, intent: p.message, kind: "genome-amendment", affectedNodes: applied.touched },
    { newNodes: ops.filter((o) => o.op === "add").map((o) => o.node) })).evolution;
  const stub = systemStub(env, systemId);
  let startedId:string|undefined;
  try {
    // The fork must start from `base`: the DO refuses the reservation when the head moved after the claim.
    // Added nodes have no origin in the base model, so the packet permits the directories the codec wrote them to.
    const permittedExtra = Object.values(applied.created).map((dir) => `${dir}/**`);
    const start = await startWork(env, systemId, evolution.id, { target: "genome", origin: "editor", agentLabel: INTENT_AGENT }, platformUrl,
      { expectedBase: base, permittedExtra });
    startedId=start.realization.id;
    const edit = await commitEdit(env, systemId, start.realization.id, {
      message: title, why: p.message,
      changes: applied.changes.map((c) => ({ path: prefix ? `${prefix}/${c.path}` : c.path, content: c.content })),
    }, "intent");
    return {
      evolution: (await stub.evolution(evolution.id)) ?? evolution, realization: edit.submitted.realization,
      candidate: edit.submitted.candidate, commit: edit.commit,
    };
  } catch (e) {
    // Leave nothing a retry would duplicate: the Evolution goes with its realization (token revoked, unregistered).
    try {
      const records=startedId?[await stub.realization(startedId)]:[];
      const ended=records.filter(r=>r!==null).map(r=>({realizationId:r!.realization.id,forkRepo:r!.forkRepo,tokenId:r!.tokenId}));
      for(const item of ended)await stub.rejectRealization(item.realizationId,'Genome proposal push failed');
      await revokeEnded(env, systemId, ended);
      await Promise.all(ended.map((x) => registryStub(env).unregisterRealization(systemId, x.realizationId)));
      await refreshRegistry(env, systemId);
    } catch (w) {
      console.error(`[intents] discarding ${evolution.id} after a failed accept failed: ${(w as Error)?.message ?? w}`);
    }
    if (e instanceof HttpError && e.code === "stale-base") {
      const head = (await stub.state())?.genomeCommit ?? null;
      throw conflict("stale-base", `the Genome moved from ${base.slice(0, 12)} while accepting; describe the change again`, { currentHead: head });
    }
    throw e;
  }
}
