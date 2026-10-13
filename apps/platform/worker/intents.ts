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
import type { IntentAcceptResponse, IntentDecisionsRequest, Proposal, ProposalPlanNode, ProposalProblem, ProposalQuestion, ProposedOp } from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { genomePrefix } from "./artifacts/genome-source";
import { SystemAuthority, type HeadState } from "./do/system-authority";
import { MAX_TURNS, type ProposalTurn } from "./do/proposals-store";
import { commitEdit } from "./editor";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { createEvolution, genomeAt, refreshRegistry, registryStub, revokeEnded, startWork, systemStub } from "./service";
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
  return {
    s1: override.s1 ?? providerFromEnv(env as unknown as ProviderEnv),
    translator: override.translator ?? translatorFromEnv(env as unknown as TranslatorEnv),
  };
}

// ------------------------------------------------------------------ head Genome

interface HeadGenome { state: HeadState; files: Map<string, string>; graph: Graph; template: Template; readiness: Readiness }

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

export type PlanDecision = NonNullable<ProposalPlanNode["decision"]>;
/** The admin's explicit decisions, by plan node id; a node without one inherits its nearest decided ancestor's. */
export type PlanDecisions = Record<string, PlanDecision>;

/** The trailing node holding ops whose node is in neither the head tree nor the proposal's adds. */
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
 * The agreement tree of `ops` over the head `tree`. Each op belongs to one node: an `add` to the node it mints (placed
 * under its `parent`, else the System root), a `link`/`unlink` to its `from` node, any other op to the node it names.
 * The tree is rooted at Things (kind `thing`), or at the System root for a node outside every Thing; the nodes between
 * a root and an op's node are kept (with no ops of their own) so the tree follows the Genome's containment. `path` is
 * the ancestor chain from the System root (the node excluded). Ops whose node is unknown go under a trailing
 * `other` node. Every op id is in exactly one node's `opIds`; `summary` counts the ops of the node's subtree. `title`
 * names a node (default: its, or its add's, `title`/`name` field, else its id).
 */
export function planOf(ops: ProposedOp[], tree: GenomeTree, title?: (id: string) => string | undefined): ProposalPlanNode[] {
  const adds = new Map(ops.filter((o) => o.op === "add").map((o) => [o.node, o] as const));
  const chains = new Map<string, string[] | null>();
  /** Root-first ids from the System root to `id` (inclusive), or null when `id` is unknown. */
  const chain = (id: string, seen = new Set<string>()): string[] | null => {
    if (chains.has(id)) return chains.get(id)!;
    let out: string[] | null = null;
    const n = tree.nodes.get(id);
    if (n) {
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
    const start = thing === -1 ? 0 : thing;
    let parent: Draft | undefined;
    for (let i = start; i < ids.length; i++) {
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

/** `plan` with each node's explicit decision from `decisions` (an id the plan no longer has is ignored). */
export function withDecisions(plan: ProposalPlanNode[], decisions: PlanDecisions): ProposalPlanNode[] {
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
export function applyDecisions(plan: ProposalPlanNode[], decisions: PlanDecisions, changes: IntentDecisionsRequest["decisions"]): PlanDecisions {
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

/** Each node's effective decision: its own, else its nearest decided ancestor's, else none. */
export function effectiveDecisions(plan: ProposalPlanNode[], decisions: PlanDecisions): Map<string, PlanDecision | undefined> {
  const out = new Map<string, PlanDecision | undefined>();
  for (const { node, parent } of walkPlan(plan)) out.set(node.id, decisions[node.id] ?? (parent === undefined ? undefined : out.get(parent)));
  return out;
}

/**
 * The ops of `plan` by effective decision, and the explicitly deferred nodes that hold deferred ops (topmost first).
 * Undecided ops are in none of the sets.
 */
export function opsByDecision(plan: ProposalPlanNode[], decisions: PlanDecisions) {
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

// ------------------------------------------------------------------ plan storage (W3's ProposalsStore columns)

/**
 * The DO's plan and decision columns. TODO(W3): `ProposalsStore`/`SystemAuthority` add `proposalPlan` and
 * `setProposalPlan`; until they do, decisions are not stored (reads see none, a decisions PUT is a 501) and every
 * accept takes any op ids, as before plans.
 */
interface PlanStore {
  proposalPlan(pid: string): Promise<{ plan: ProposalPlanNode[]; decisions: PlanDecisions; deferredFrom?: string } | null>;
  /** Written only while the proposal is open. */
  setProposalPlan(pid: string, plan: ProposalPlanNode[], decisions: PlanDecisions, deferredFrom?: string): Promise<boolean>;
}
export function planStoreReady(): boolean {
  const proto = SystemAuthority.prototype as unknown as Partial<PlanStore>;
  return typeof proto.setProposalPlan === "function" && typeof proto.proposalPlan === "function";
}
const planStore = (env: Env, systemId: string) => systemStub(env, systemId) as unknown as PlanStore;

async function decisionsOf(env: Env, systemId: string, pid: string): Promise<PlanDecisions> {
  if (!planStoreReady()) return {};
  return (await planStore(env, systemId).proposalPlan(pid))?.decisions ?? {};
}

/** The wire proposal: a stored one from before plans has none (`[]`); decisions merged into its nodes. */
function onWire(p: Proposal, decisions: PlanDecisions = {}): Proposal {
  return { ...p, plan: withDecisions(Array.isArray(p.plan) ? p.plan : [], decisions) };
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
  const plan = planOf(ops, parseTree(h.files), titles(h, ops));
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

/** Plan titles as the head shows them: an existing node's title (titleOf), an add's under its kind's name field. */
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
  return onWire((await stored(env, systemId, pid)).proposal, await decisionsOf(env, systemId, pid));
}

/**
 * `PUT …/decisions`: the admin's decisions on plan nodes, applied in order (see applyDecisions) and stored in one
 * write while the proposal is open (409 `invalid-state` otherwise; 404 for a node the plan lacks).
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
  const s = await stored(env, systemId, pid);
  if (s.proposal.status !== "open" || s.accepting) throw conflict("invalid-state", `proposal ${pid} is ${s.accepting ? "being accepted" : s.proposal.status}`);
  if (!planStoreReady()) throw new HttpError(501, "not-implemented", "this platform cannot store plan decisions yet");
  const plan = onWire(s.proposal).plan;
  const decisions = applyDecisions(plan, await decisionsOf(env, systemId, pid), changes as IntentDecisionsRequest["decisions"]);
  if (!(await planStore(env, systemId).setProposalPlan(pid, plan, decisions, s.proposal.deferredFrom))) {
    throw conflict("invalid-state", `proposal ${pid} is no longer open`);
  }
  return onWire(s.proposal, decisions);
}

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
  const turns = [...s.turns, { ...(question && { question: question.text }), answer }];
  const h = await headGenome(env, systemId);
  const turn = await runTurn(env, h, conversation(h, s.proposal.message, s.proposal.anchor, turns), `q.${turns.length + 1}`);
  const { answer: _previous, ...rest } = s.proposal;
  const r = await systemStub(env, systemId).reviseProposal({ ...rest, ...turn }, turns);
  if ("revised" in r) return onWire(r.revised, await decisionsOf(env, systemId, pid));
  if (r.refused === "too-many-turns") throw tooManyTurns(pid);
  if (r.refused === "changed") throw conflict("invalid-state", `another reply to proposal ${pid} landed first; read it and reply again`);
  throw conflict("invalid-state", `proposal ${pid} is no longer open`);
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
interface DeferredOps { ops: ProposedOp[]; nodeIds: string[] }

/**
 * The chosen ops of `p` under its plan decisions. Once any node is decided, the chosen ops must all be under
 * effectively agreed nodes (else 422 `invalid-ops` naming them) and the effectively deferred ops are returned to move
 * to a new proposal; rejected and undecided ops are dropped. With no decisions at all, any ops may be chosen (as
 * before plans) and nothing is deferred.
 */
function chosenByPlan(p: Proposal, opIds: string[], decisions: PlanDecisions): { ops: ProposedOp[]; deferred?: DeferredOps } {
  if (!Object.keys(decisions).length) return { ops: chosenOps(p, opIds) };
  const unknown = opIds.filter((id) => !p.ops.some((o) => o.id === id));
  if (unknown.length) throw badRequest(`proposal ${p.id} has no ops ${unknown.join(", ")}`);
  const by = opsByDecision(onWire(p).plan, decisions);
  const offenders = [...new Set(opIds)].filter((id) => !by.agreed.has(id));
  if (offenders.length) throw unprocessable("invalid-ops", `only ops under agreed nodes can be accepted: ${offenders.join(", ")}`, { offenders });
  const ops = chosenOps(p, opIds);
  const deferredOps = p.ops.filter((o) => by.deferred.has(o.id));
  return { ops, ...(deferredOps.length && { deferred: { ops: deferredOps, nodeIds: by.deferredNodes } }) };
}

/**
 * The new open proposal holding an accept's deferred ops: same System, message, anchor, route and provenance (so the
 * same base Genome), the deferred ops with their dependencies on ops outside them dropped, their problems, a plan
 * rebuilt over them on `tree`, no decisions, `deferredFrom` the accepted proposal.
 */
async function deferProposal(env: Env, systemId: string, p: Proposal, d: DeferredOps, tree: GenomeTree): Promise<Proposal> {
  const keep = new Set(d.ops.map((o) => o.id));
  const ops = d.ops.map((o) => {
    if (!o.dependsOn) return o;
    const { dependsOn, ...rest } = o;
    const kept = dependsOn.filter((x) => keep.has(x));
    return kept.length ? { ...rest, dependsOn: kept } : rest;
  });
  const known = new Map([...walkPlan(onWire(p).plan)].map((x) => [x.node.id, x.node.title] as const));
  const { id: _id, answer: _answer, deferredFrom: _from, ...base } = p;
  return systemStub(env, systemId).createProposal({
    ...base, status: "open", ops, questions: [], problems: p.problems.filter((x) => x.opId !== undefined && keep.has(x.opId)),
    plan: planOf(ops, tree, (id) => known.get(id)), deferredFrom: p.id, createdAt: nowIso(),
  });
}

/**
 * A deferred proposal keeps the base of the proposal it came from, and that head moves once the sibling's Genome
 * candidate is accepted. Before the claim, an open deferred proposal behind the head is re-validated: its chosen ops
 * (with their dependencies) are applied to the head Genome, and when they still apply its base moves to the head, so
 * the claim and the push work on the head. When they no longer apply (an unknown node, a conflicting state) the accept
 * is a 409 `stale-base`. Any other proposal, or one already on the head, is left for the claim to judge.
 */
async function rebaseDeferred(env: Env, systemId: string, pid: string, opIds: string[]): Promise<void> {
  const s = await systemStub(env, systemId).proposal(pid);
  if (!s || s.accepting || s.proposal.status !== "open" || !s.proposal.deferredFrom) return;
  const base = s.proposal.provenance.genomeCommit;
  const h = await headGenome(env, systemId);
  const head = h.state.genomeCommit;
  if (base === head) return;
  const ops = chosenOps(s.proposal, opIds);
  try {
    applyOps(h.files, ops as TreeOp[]);
  } catch (e) {
    if (!(e instanceof TreeOpError) && !(e instanceof GenomeTreeError)) throw e;
    const why = e instanceof TreeOpError ? `${ops[e.op]?.id ?? "an op"} ${e.message.replace(/^op \d+: /, "")}` : e.message;
    throw conflict("stale-base", `the Genome moved to ${head.slice(0, 12)} since these ops were deferred and they no longer apply (${why}); describe the change again`,
      { currentHead: head });
  }
  // False when another accept or a head move got there first: the claim then says why.
  await systemStub(env, systemId).rebaseProposal(pid, base, head);
}

/**
 * `POST …/accept`: the chosen ops (each with the ops it depends on, else 422) become a `genome-amendment` Evolution
 * whose affected nodes are the touched nodes, a Genome realization (origin `editor`) and one commit pushed to its fork
 * and submitted as a candidate. The DO first moves the proposal open → accepting while the head is still the
 * proposal's `genomeCommit` (409 `invalid-state` / `stale-base` otherwise), so concurrent accepts cannot both push.
 * A deferred proposal behind the head is first moved onto it when its ops still apply there (rebaseDeferred).
 * The op ids are checked against the revision the claim returned, never an earlier read, since a reply re-mints them,
 * and against its plan decisions (chosenByPlan); the deferred ops move to a new open proposal once the commit is pushed.
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
  let tree: GenomeTree;
  let deferred: DeferredOps | undefined;
  try {
    let ops: ProposedOp[];
    try {
      ({ ops, deferred } = chosenByPlan(claim.claimed, opIds as string[], await decisionsOf(env, systemId, pid)));
    } catch (e) {
      await stub.releaseProposal(pid, claim.claimedAt, null);
      throw e;
    }
    ({ out, tree } = await pushAccepted(env, systemId, claim.claimed, ops, platformUrl));
  } catch (e) {
    await stub.releaseProposal(pid, claim.claimedAt, (e as Error)?.message ?? String(e)).catch((r: unknown) =>
      console.error(`[intents] releasing proposal ${pid} failed: ${(r as Error)?.message ?? r}`));
    throw e;
  }
  // Pushed: the proposal is accepted whatever happens next, so a retry can never push the change twice.
  const ids = { evolution: out.evolution.id, realization: out.realization.id, candidate: out.candidate.id, commit: out.commit };
  let deferError: string | undefined;
  if (deferred) {
    try {
      out = { ...out, deferred: { proposal: (await deferProposal(env, systemId, claim.claimed, deferred, tree)).id, nodeIds: deferred.nodeIds } };
    } catch (e) {
      deferError = `moving the deferred ops ${deferred.ops.map((o) => o.id).join(", ")} to a new proposal failed: ${(e as Error)?.message ?? e}`;
      console.error(`[intents] ${pid}: ${deferError}`);
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

/**
 * The accept's work once the proposal is claimed: apply, a `mixed` Evolution (admin accept of its Genome candidate
 * makes it `genome-approved`, ready for app work), Genome realization, commit and candidate; with the base tree.
 */
async function pushAccepted(env: Env, systemId: string, p: Proposal, ops: ProposedOp[], platformUrl: string): Promise<{ out: IntentAcceptResponse; tree: GenomeTree }> {
  const base = p.provenance.genomeCommit;
  const state = await systemStub(env, systemId).state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const { files } = await genomeAt(env, systemId, base, state.genomeSource);
  let applied;
  let tree: GenomeTree;
  try {
    tree = parseTree(files);
    applied = applyOps(files, ops as TreeOp[]);
  } catch (e) {
    if (e instanceof TreeOpError) throw unprocessable("invalid-ops", `${ops[e.op]?.id ?? "an op"} cannot apply: ${e.message.replace(/^op \d+: /, "")}`);
    if (e instanceof GenomeTreeError) throw unprocessable("invalid-ops", e.message);
    throw e;
  }
  if (!applied.changes.length) throw unprocessable("no-change", "the chosen ops change nothing");
  const prefix = await withRepo(artifactsFor(env), state.genomeSource, (r) => genomePrefix(r, base));

  const title = p.message.split("\n")[0]!.trim().slice(0, 200);
  const { evolution } = await createEvolution(env, systemId, { title, intent: p.message, kind: "mixed", affectedNodes: applied.touched },
    { newNodes: ops.filter((o) => o.op === "add").map((o) => o.node) });
  const stub = systemStub(env, systemId);
  try {
    // The fork must start from `base`: the DO refuses the reservation when the head moved after the claim.
    // Added nodes have no origin in the base model, so the packet permits the directories the codec wrote them to.
    const permittedExtra = Object.values(applied.created).map((dir) => `${dir}/**`);
    const start = await startWork(env, systemId, evolution.id, { target: "genome", origin: "editor", agentLabel: INTENT_AGENT }, platformUrl,
      { expectedBase: base, permittedExtra });
    const edit = await commitEdit(env, systemId, start.realization.id, {
      message: title, why: p.message,
      changes: applied.changes.map((c) => ({ path: prefix ? `${prefix}/${c.path}` : c.path, content: c.content })),
    }, "intent");
    const out = {
      evolution: (await stub.evolution(evolution.id)) ?? evolution, realization: edit.submitted.realization,
      candidate: edit.submitted.candidate, commit: edit.commit,
    };
    return { out, tree };
  } catch (e) {
    // Leave nothing a retry would duplicate: the Evolution goes with its realization (token revoked, unregistered).
    try {
      const ended = await stub.discardEvolution(evolution.id);
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
