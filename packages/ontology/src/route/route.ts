import type { Graph, GraphNode } from "../graph/graph.ts";
import { decide, thresholdsOf } from "../judge/policy.ts";
import { contentWords } from "../judge/prefilter.ts";
import type { JudgmentStatus, SystemOne, Usage } from "../judge/types.ts";
import { toWire } from "../judge/wire.ts";
import type { Question } from "../meta/schema.ts";
import {
  ROUTE_NEW, ROUTE_NONE, ROUTE_UNCLEAR, type Route, type RouteIntent, type RouteLevel, type RouteOptions, type RouteStep,
} from "./types.ts";

/** The parts of a template routing reads: kind descriptions and relation endpoints. */
export interface RouteVocabularySource {
  kinds: Record<string, { description?: string; fields?: { name: string }[] }>;
  relations: Record<string, { from: string[]; to: string[] }>;
}

export const ROUTE_DEFAULTS = { maxChoices: 12, maxNodes: 3, maxCalls: 8, examples: 3 } as const;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A node's display title: `title`, else the world snapshot's `ws.title`, else its id. */
export const titleOf = (n: GraphNode): string => str(n.fields.title) || str(n.fields["ws.title"]) || n.id;
const descOf = (n: GraphNode): string => str(n.fields.description);

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
/** Content words of a text with a light plural strip, so "reminders" meets "reminder". */
export const routeTokens = (s: string): Set<string> => new Set([...contentWords(s)].map(stem));

/** Words of a kind's name (camelCase and dashes split) and of its label's head before any colon. */
export const kindTokens = (kind: string, label = ""): Set<string> =>
  routeTokens(`${kind.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_.]/g, " ")} ${label.split(":")[0] ?? ""}`);

/** Term overlap of a node with the message: two per shared title word, one per word only its description shares. */
export function overlapScore(message: Set<string>, n: GraphNode): number {
  const t = routeTokens(titleOf(n)), d = routeTokens(descOf(n));
  let s = 0;
  for (const w of message) s += t.has(w) ? 2 : d.has(w) ? 1 : 0;
  return s;
}

export interface RouteSpace { key: string; label: string; nodes: string[]; kinds: string[] }

/** The routable part of a graph: its root, and its spaces with their nodes in graph order. */
export interface RouteView {
  root: string;
  mode: "map" | "tree";
  byId: Map<string, GraphNode>;
  order: Map<string, number>;
  spaces: RouteSpace[];
  /** Every routable node except the root. */
  nodes: string[];
}

function rootOf(g: Graph, children: Map<string, string[]>): string {
  const size = (id: string) => {
    const seen = new Set<string>([id]);
    for (const queue = [id]; queue.length;) for (const c of children.get(queue.pop()!) ?? []) if (!seen.has(c)) { seen.add(c); queue.push(c); }
    return seen.size;
  };
  let best: string | undefined, bestSize = -1;
  for (const n of g.nodes) {
    if (n.parent !== undefined || n.kind.startsWith("ws.")) continue;
    const s = size(n.id);
    if (s > bestSize) { best = n.id; bestSize = s; }
  }
  if (best === undefined) throw new Error("route: the graph has no root node");
  return best;
}

/** Spaces from `opts.spaces` (kind map) when given, else the root's sections plus the root itself. */
export function routeView(g: Graph, opts: RouteOptions = {}): RouteView {
  const byId = new Map<string, GraphNode>(), order = new Map<string, number>(), children = new Map<string, string[]>();
  g.nodes.forEach((n, i) => {
    if (byId.has(n.id)) return;
    byId.set(n.id, n);
    order.set(n.id, i);
  });
  for (const n of byId.values()) if (n.parent !== undefined) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const root = opts.root ?? rootOf(g, children);
  if (!byId.has(root)) throw new Error(`route: root ${root} is not a node`);
  const subtree = (id: string): string[] => {
    const out: string[] = [], seen = new Set<string>([id]);
    for (const queue = [id]; queue.length;) {
      const cur = queue.shift()!;
      out.push(cur);
      for (const c of children.get(cur) ?? []) if (!seen.has(c)) { seen.add(c); queue.push(c); }
    }
    return out.sort((a, b) => order.get(a)! - order.get(b)!);
  };
  const nodes = subtree(root).filter((id) => id !== root);

  if (opts.spaces) {
    const spaceOf = new Map<string, string>();
    for (const [s, ks] of Object.entries(opts.spaces)) for (const k of ks) if (!spaceOf.has(k)) spaceOf.set(k, s);
    const keys = [...Object.keys(opts.spaces), "other"];
    const spaces = keys.map((key) => ({
      key, label: opts.spaceLabels?.[key] ?? key, kinds: opts.spaces![key] ?? [],
      nodes: nodes.filter((id) => (spaceOf.get(byId.get(id)!.kind) ?? "other") === key),
    })).filter((s) => s.key !== "other" || s.nodes.length);
    return { root, mode: "map", byId, order, spaces, nodes };
  }
  const label = (id: string) => { const n = byId.get(id)!; return `${titleOf(n)} (${n.kind})`; };
  const sections = (children.get(root) ?? []).slice().sort((a, b) => order.get(a)! - order.get(b)!);
  const spaces: RouteSpace[] = sections.map((s) => ({ key: s, label: label(s), kinds: [], nodes: subtree(s) }));
  spaces.push({ key: root, label: `Top level of ${label(root)}: the whole and its direct parts`, kinds: [], nodes: [root, ...sections] });
  return { root, mode: "tree", byId, order, spaces, nodes };
}

/** `ids` ordered by term overlap with the message, ties in graph order. */
export function rankNodes(view: RouteView, message: string | Set<string>, ids: string[]): string[] {
  const m = typeof message === "string" ? routeTokens(message) : message;
  const score = new Map(ids.map((id) => [id, overlapScore(m, view.byId.get(id)!)]));
  return [...ids].sort((a, b) => score.get(b)! - score.get(a)! || view.order.get(a)! - view.order.get(b)!);
}

const INTENT_TEXT: Record<string, string> = {
  add: "Add something new to the specification",
  update: "Change an existing item: its wording, a number, its scope",
  remove: "Remove or drop an existing item",
  link: "Move or reconnect existing items: change which items relate to which",
  question: "Too vague to act on: we must ask the user which part they mean",
  answer: "The user asks for information; nothing changes",
  [ROUTE_UNCLEAR]: "None of these fits",
};

const SLICE = { parents: false, hops: 0, direction: "out" as const, children: false, textCap: 600 };
const RANK: Record<JudgmentStatus, number> = { confident: 2, review: 1, unknown: 0 };
const worse = (a: JudgmentStatus, b: JudgmentStatus): JudgmentStatus => (RANK[a] <= RANK[b] ? a : b);

/** Option criteria for the candidate nodes of the node levels. */
const nodeCriterion = (n: GraphNode, withKind: boolean) =>
  `${withKind ? `${n.kind}: ` : ""}${titleOf(n)}${descOf(n) ? `: ${clip(descOf(n), 120)}` : ""}`;

/** Intent criteria for `intent-last`, worded around the items the navigation put in view. */
const intentInView = (picked: boolean, kind?: string): Record<string, string> => {
  const item = picked ? "a picked existing item (state.so_far.picked)" : `an existing ${kind ?? "item"}`;
  return {
    add: picked ? "Add a new item that does not exist yet, anchored near the picked item" : `Add a new ${kind ?? "item"} that does not exist yet`,
    update: `Change the wording, value or scope of ${item}`,
    remove: `Remove or drop ${item}`,
    link: picked ? "Add or remove a relation between picked items, or move one under another" : "Add or remove a relation between existing items, or move one under another",
    question: "The message is unclear about which item or what change is meant; we must ask the user",
    answer: "The message asks for information; nothing changes",
    [ROUTE_UNCLEAR]: "None of these fits",
  };
};

/**
 * Routes a user message to the part of the graph it concerns with a chain of small System One questions, each
 * offering only its level's options with a short description or a few example titles.
 *
 * - `shortlist-first` (default): one question over the (at most `maxChoices`) nodes sharing the most words with the
 *   message. A picked node fixes space and kind; follow-ups may add shortlisted nodes or same-kind siblings; then the
 *   intent, and for `add` the new item's kind. With no shortlist, or `none`, the intent-last chain runs, where an
 *   unknown space falls back to a kind question over every kind with nodes, and a `new` below confident is settled by
 *   the anchor question (`target.new` only when the anchor is `none`).
 * - `intent-last`: space, kind, node, up to `maxNodes - 1` "does it also concern another?" follow-ups, then the intent
 *   with the picked nodes in view; for an `add` with nothing picked, one more question picks the anchor in the space.
 * - `intent-first`: the intent first; a `question` or `unclear` intent ends the route, and for `add` the node level
 *   picks the anchor directly.
 *
 * Navigation goes on past `review` answers (unless `continueOnReview: false`) and stops on `unknown`, on `none` or
 * when `maxCalls` runs out (one call stays reserved for an intent asked last); the partial path is kept. The route's
 * status is the lowest of its deciding steps, lowered to `review` when the target the intent needs is missing
 * (nodes for update, remove, link and answer; a kind for add) and to `unknown` for an `unclear` intent.
 */
export async function route(g: Graph, template: RouteVocabularySource, message: string, s1: SystemOne, opts: RouteOptions = {}): Promise<Route> {
  const view = routeView(g, opts);
  const t = thresholdsOf(opts.thresholds);
  const order = opts.order ?? "shortlist-first";
  const intentLast = order !== "intent-first";
  const continueOnReview = opts.continueOnReview ?? true;
  const maxChoices = opts.maxChoices ?? ROUTE_DEFAULTS.maxChoices;
  const maxNodes = opts.maxNodes ?? ROUTE_DEFAULTS.maxNodes;
  const maxCalls = opts.maxCalls ?? ROUTE_DEFAULTS.maxCalls;
  const nExamples = opts.examples ?? ROUTE_DEFAULTS.examples;
  const words = routeTokens(message);
  const node = (id: string) => view.byId.get(id)!;
  const examples = (ids: string[]) => rankNodes(view, words, ids).slice(0, nExamples).map((id) => clip(titleOf(node(id)), 60));
  const withExamples = (label: string, ids: string[]) => { const ex = examples(ids); return ex.length ? `${label}. e.g. ${ex.join("; ")}` : label; };
  const kindLabel = (k: string) => opts.kindLabels?.[k] ?? template.kinds[k]?.description ?? k;

  const path: RouteStep[] = [];
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const errors: string[] = [];
  let provider = s1.mode === "off" ? "off" : "", model = s1.model, calls = 0, truncated = false as boolean;
  let status: JudgmentStatus = "confident";
  // Assigned inside the closures below; typed through `as` so control flow does not narrow them to their initial values.
  let intent = undefined as RouteIntent | undefined, space = undefined as string | undefined, kind = undefined as string | undefined;
  let isNew = false as boolean;
  const picked: string[] = [];
  /** Calls kept back for the intent question when it comes last. */
  const reserve = () => (intentLast && intent === undefined ? 1 : 0);

  async function ask(level: RouteLevel, id: string, text: string, options: [string, string][], declared: [string, string][], benign: string): Promise<RouteStep | undefined> {
    if (calls >= maxCalls - (level === "intent" ? 0 : reserve())) { truncated = true; return undefined; }
    const yesNo = level === "more";
    const q: Question = yesNo
      ? { id, text, answer: "yes-no", choices: declared.map(([, c]) => c), benign: "no", slice: SLICE, policy: [{ answer: "yes", level: "pass" }, { answer: "no", level: "pass" }] }
      : {
        id, text, answer: "choice", choices: declared.map(([k]) => k), criteria: Object.fromEntries(declared), choicesFrom: "members",
        benign, slice: SLICE, policy: [{ answer: "*", level: "pass" }],
      };
    const wire = toWire(q, undefined, Object.fromEntries(options));
    const choices = wire.type === "choice" ? Object.keys(wire.criteria) : ["yes", "no"];
    const so_far = {
      intent, space: space === undefined ? undefined : view.spaces.find((s) => s.key === space)?.label, kind, ...(isNew && { new: true }),
      picked: picked.map((p) => ({ kind: node(p).kind, title: titleOf(node(p)), ...(descOf(node(p)) ? { description: clip(descOf(node(p)), 300) } : {}) })),
    };
    const state = { task: "route", message, level, so_far };
    calls++;
    let step: RouteStep;
    try {
      const reply = await s1.ask(state, { [id]: wire }, opts.ask);
      provider = reply.provider; model = reply.model;
      usage.input_tokens += reply.usage?.input_tokens ?? 0; usage.output_tokens += reply.usage?.output_tokens ?? 0;
      const d = decide(q, reply.answers[id], t);
      const valid = d.answer !== undefined && choices.includes(d.answer);
      step = {
        level, id, question: text, choices,
        ...(d.answer !== undefined && { answer: d.answer }),
        ...(d.confidence !== undefined && { confidence: d.confidence }),
        ...(d.probabilities && { probabilities: d.probabilities }),
        status: valid ? d.status : "unknown",
      };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      errors.push(msg);
      if (!provider) provider = "error";
      step = { level, id, question: text, choices, status: "unknown", error: msg };
    }
    path.push(step);
    return step;
  }
  const usable = (s: RouteStep | undefined): s is RouteStep & { answer: string } =>
    !!s && s.answer !== undefined && (s.status === "confident" || (s.status === "review" && continueOnReview));
  /** Folds a deciding step into the route status; true when the chain may go on with its answer. */
  const proceed = (s: RouteStep | undefined): s is RouteStep & { answer: string } => {
    if (!s) { status = worse(status, "review"); return false; }
    status = worse(status, s.status);
    return usable(s);
  };

  const sectionOf = () => view.spaces.find((s) => s.key === space);
  /** A node's own space: its section (not the root's top-level space) in tree mode, its kind's space in map mode. */
  const spaceOfNode = (id: string) => (view.spaces.find((s) => s.key !== view.root && s.nodes.includes(id)) ?? view.spaces.find((s) => s.nodes.includes(id)))?.key;
  const spaceOfKind = (k: string) => (view.mode === "map" ? view.spaces.find((s) => s.kinds.includes(k))?.key : undefined);
  const ofKind = (k: string, pool: string[] = sectionOf()?.nodes ?? view.nodes) => pool.filter((id) => node(id).kind === k);
  const offered = (pool: string[], withKind: boolean) => pool.slice(0, maxChoices).map((id): [string, string] => [id, nodeCriterion(node(id), withKind)]);
  const shortlistFirst = order === "shortlist-first";
  /** shortlist-first: a `new` answer below confident; the anchor question then decides whether the target is new. */
  let lowNew = false;
  /** shortlist-first: kind and space came from a shortlisted node, so an `add` must still ask the new item's kind. */
  let fromShortlist = false;

  /** Kinds ranked by overlap of their label and member titles with the message, then `prefer` order, then size. */
  function rankKinds(pool: string[], prefer: string[] = []): string[] {
    const members = (k: string) => view.nodes.filter((id) => node(id).kind === k);
    const score = new Map(pool.map((k) => {
      const label = kindTokens(k, kindLabel(k));
      let sc = 0;
      for (const w of words) if (label.has(w)) sc += 2;
      return [k, sc + Math.max(0, ...members(k).map((id) => overlapScore(words, node(id))))];
    }));
    const pref = (k: string) => { const i = prefer.indexOf(k); return i < 0 ? prefer.length : i; };
    return [...pool].sort((x, y) => score.get(y)! - score.get(x)! || pref(x) - pref(y) || members(y).length - members(x).length || (x < y ? -1 : 1));
  }

  async function askIntent(): Promise<boolean> {
    const text = intentLast
      ? `A user sent state.message about a product or system specification; state.so_far shows the ${picked.length ? "items it concerns" : "area and kind it concerns"}. What do they want done?`
      : "A user sent state.message about a product or system specification. What do they want done to the specification?";
    const iStep = await ask("intent", "route.intent", text, Object.entries(intentLast ? intentInView(picked.length > 0, kind) : INTENT_TEXT), [], "update");
    if (!proceed(iStep)) return false;
    intent = iStep.answer as RouteIntent;
    return true;
  }

  /** "Does it also concern another?" follow-ups over `pool`; they only add nodes and never lower the route's status. */
  async function followUps(pool: string[], withKind: boolean): Promise<void> {
    while (picked.length < maxNodes) {
      const rest = pool.filter((id) => !picked.includes(id));
      if (!rest.length) break;
      if (calls + 2 > maxCalls - reserve()) { truncated = true; break; }
      const listed = rest.slice(0, maxChoices).map((id) => titleOf(node(id))).join("; ");
      const more = await ask("more", "route.more",
        `Besides ${picked.map((p) => `"${titleOf(node(p))}"`).join(", ")}, does state.message also concern another of these items?`,
        [], [["yes", `Yes: it also concerns one of: ${listed}`], ["no", "No: those already picked are all it concerns"]], "no");
      if (!usable(more) || more.answer !== "yes") break;
      const next = await ask("nodes", "route.nodes", "Which other item does state.message also concern?", offered(rest, withKind), [[ROUTE_NONE, "None of these"]], ROUTE_NONE);
      if (!usable(next) || next.answer === ROUTE_NONE) break;
      picked.push(next.answer);
    }
  }

  /**
   * shortlist-first: one node question over the nodes sharing the most words with the message (title, description and
   * kind name). A picked node fixes space and kind. False when nothing was shortlisted or the pick was `none` or not usable.
   */
  async function shortlist(): Promise<boolean> {
    const scored = view.nodes.map((id) => {
      const n = node(id);
      let sc = overlapScore(words, n);
      const k = kindTokens(n.kind, kindLabel(n.kind));
      for (const w of words) if (k.has(w)) sc += 1;
      return [id, sc] as const;
    }).filter(([, sc]) => sc > 0);
    const pool = scored.sort((x, y) => y[1] - x[1] || view.order.get(x[0])! - view.order.get(y[0])!).map(([id]) => id).slice(0, maxChoices);
    if (!pool.length) return false;
    const st = await ask("shortlist", "route.shortlist",
      "Which of these items does state.message concern most directly? Pick none when it is about none of them.",
      offered(pool, true), [[ROUTE_NONE, "None of these items"]], pool[0]!);
    if (!usable(st) || st.answer === ROUTE_NONE) return false;
    status = worse(status, st.status);
    picked.push(st.answer);
    space = spaceOfNode(st.answer);
    kind = node(st.answer).kind;
    fromShortlist = true;
    await followUps([...pool, ...rankNodes(view, words, ofKind(kind, view.nodes)).filter((id) => !pool.includes(id))], true);
    return true;
  }

  /**
   * Space, kind, node and follow-ups. `adding` is known only when the intent came first. With `spaceFallback`, an
   * unknown space answer does not stop the chain: the kind is asked over every kind with nodes and the node across the graph.
   */
  async function navigate(adding: boolean | undefined, spaceFallback = false): Promise<void> {
    const mayAdd = adding !== false;
    const spaces = view.spaces.filter((s) => s.nodes.length || (mayAdd && s.kinds.length));
    const sStep = await ask("space", "route.space",
      adding ? "Which area of the specification does state.message add to?" : adding === false ? "Which area of the specification does state.message concern?"
        : "Which area of the specification does state.message concern or add to?",
      spaces.map((s) => [s.key, withExamples(s.label, s.nodes)]), [[ROUTE_NONE, "None of these areas"]], spaces[0]?.key ?? ROUTE_NONE);
    let sp: RouteSpace | undefined;
    if (spaceFallback && sStep?.status === "unknown") {
      status = worse(status, "review"); // the space was skipped, not decided
    } else {
      if (!proceed(sStep) || sStep.answer === ROUTE_NONE) return;
      space = sStep.answer;
      sp = sectionOf()!;
    }
    const scope = sp?.nodes ?? view.nodes;

    const present = [...new Set(scope.map((id) => node(id).kind))];
    const kinds = !sp ? rankKinds(present).slice(0, maxChoices)
      : mayAdd ? [...present, ...sp.kinds.filter((k) => !present.includes(k) && k in template.kinds)] : present;
    const where = sp ? ` in ${sp.label}` : "";
    const kStep = await ask("kind", "route.kind",
      adding ? `What kind of item does state.message want to add${sp ? ` to ${sp.label}` : ""}?` : adding === false ? `Which kind of item${where} does state.message concern?`
        : `Which kind of item${where} does state.message concern or want to add?`,
      kinds.map((k) => [k, withExamples(kindLabel(k), ofKind(k, scope))]), [[ROUTE_NONE, "None of these kinds"]], kinds[0] ?? ROUTE_NONE);
    if (!proceed(kStep) || kStep.answer === ROUTE_NONE) return;
    kind = kStep.answer;
    if (!sp) space = spaceOfKind(kind);

    const candidates = rankNodes(view, words, adding ? scope : ofKind(kind, scope));
    if (!candidates.length && !adding) { isNew = true; return; } // a declared kind with no nodes yet: nothing to ask
    const nStep = await ask("node", "route.node",
      adding ? `state.message adds a new ${kind}. Which existing item should the new ${kind} connect to?`
        : `Which existing ${kind} does state.message concern?`,
      offered(candidates, !!adding),
      adding ? [[ROUTE_NONE, "No existing item; the new one stands alone"]]
        : [[ROUTE_NONE, "None of these; it is about something else"], [ROUTE_NEW, `None yet: the message is about a new ${kind}`]],
      candidates[0] ?? ROUTE_NONE);
    if (!proceed(nStep) || nStep.answer === ROUTE_NONE) return;
    if (nStep.answer === ROUTE_NEW) {
      if (shortlistFirst && nStep.status !== "confident") lowNew = true; else isNew = true;
      return;
    }
    picked.push(nStep.answer);
    if (!sp) space = spaceOfNode(nStep.answer);
    await followUps(candidates, !!adding);
  }

  /** The anchor: anywhere in the space (or graph), since a new item is rarely anchored on its own kind. */
  async function askAnchor(adding: boolean): Promise<void> {
    const pool = rankNodes(view, words, sectionOf()?.nodes ?? view.nodes);
    const aStep = await ask("anchor", "route.anchor",
      adding ? `state.message adds a new ${kind ?? "item"}. Which existing item should it connect to?`
        : "Which existing item does state.message concern or connect to?",
      offered(pool, true), [[ROUTE_NONE, adding ? "No existing item; the new one stands alone" : "None of these; it is about something new"]], pool[0] ?? ROUTE_NONE);
    if (proceed(aStep) && aStep.answer !== ROUTE_NONE) picked.push(aStep.answer);
  }

  /** The intent, then whatever the intent still needs: the new item's kind after a shortlisted anchor, or an anchor. */
  async function intentAndAfter(): Promise<void> {
    if (!(await askIntent())) { if (lowNew) isNew = true; return; }
    if (intent === "add" && fromShortlist) {
      // Kinds the message names (by kind name or label head), then every kind of the anchor's space.
      const anchorSpace = view.spaces.find((s) => s.key === space);
      const local = anchorSpace ? [...new Set([...anchorSpace.nodes.map((id) => node(id).kind), ...anchorSpace.kinds.filter((k) => k in template.kinds)])] : [];
      const pool = view.mode === "map" ? Object.keys(template.kinds).filter((k) => spaceOfKind(k) !== undefined) : [...new Set(view.nodes.map((id) => node(id).kind))];
      const named = pool.map((k) => { const t = kindTokens(k, kindLabel(k)); return [k, [...words].filter((w) => t.has(w)).length] as const; })
        .filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1] || (local.indexOf(x[0]) + 1 || 999) - (local.indexOf(y[0]) + 1 || 999)).map(([k]) => k);
      const ks = [...named, ...local.filter((k) => !named.includes(k))];
      const kStep = await ask("kind", "route.kind",
        `state.message adds a new item near "${titleOf(node(picked[0]!))}". What kind of item is the new one?`,
        ks.map((k) => [k, withExamples(kindLabel(k), ofKind(k, view.nodes))]), [[ROUTE_NONE, "None of these kinds"]], ks[0] ?? ROUTE_NONE);
      kind = proceed(kStep) && kStep.answer !== ROUTE_NONE ? kStep.answer : undefined;
      if (kind !== undefined) space = spaceOfKind(kind) ?? space;
    } else if (!picked.length && space !== undefined && (intent === "add" || lowNew)) {
      await askAnchor(intent === "add");
    }
    if (lowNew && !picked.length) isNew = true;
  }

  if (shortlistFirst) {
    if (!(await shortlist())) await navigate(undefined, true);
    await intentAndAfter();
  } else if (intentLast) {
    await navigate(undefined);
    await intentAndAfter();
  } else if (await askIntent() && intent !== "question" && intent !== ROUTE_UNCLEAR) {
    await navigate(intent === "add");
  }

  // What the intent needs and did not get.
  if (intent === ROUTE_UNCLEAR) status = worse(status, "unknown");
  else if (intent === "add" ? kind === undefined : intent !== undefined && intent !== "question" && !picked.length) status = worse(status, "review");

  // Context for the translator when nothing was picked: the nodes nearest the message in the narrowest resolved scope.
  const sp = sectionOf();
  const scope = sp ? (kind && sp.nodes.some((id) => node(id).kind === kind) ? sp.nodes.filter((id) => node(id).kind === kind) : sp.nodes) : view.nodes;
  const ranked = rankNodes(view, words, scope);
  const related = picked.length ? [] : (sp ? ranked : ranked.filter((id) => overlapScore(words, node(id)) > 0)).slice(0, 5);

  return {
    message,
    order,
    root: view.root,
    ...(intent !== undefined && { intent }),
    path,
    target: { ...(space !== undefined && { space }), ...(kind !== undefined && { kind }), nodes: picked, ...(isNew && { new: true }), related },
    status,
    calls,
    provenance: { provider: provider || s1.mode, model, usage, thresholds: t, ...(errors.length ? { errors } : {}), ...(truncated ? { truncated } : {}) },
  };
}
