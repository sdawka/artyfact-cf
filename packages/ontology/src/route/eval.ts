import type { Graph } from "../graph/graph.ts";
import { limiter } from "../judge/http.ts";
import type { AskOptions, JudgmentStatus, S1Question, SystemOne } from "../judge/types.ts";
import { routeSlice, routeVocabulary, type RouteSliceOptions } from "./context.ts";
import { route, routeTokens, type RouteVocabularySource } from "./route.ts";
import { scriptedSystemOne } from "./scripted.ts";
import { ROUTE_NEW, ROUTE_NONE, type Op, type OpProblem, type Route, type RouteOptions, type RouteOrder, type Translation, type Translator } from "./types.ts";
import { validateOps } from "./validate.ts";

/** A gold op: canonical ops, except that an `add` link may name its other end with `from` as well as `to`. */
export type GoldOp = Op;

export interface RouteGold {
  intent: string;
  space: string | null;
  kind: string | null;
  nodes: string[];
  ops?: GoldOp[];
  question?: string;
  /** Nodes a good translator also touches or flags; never scored. */
  also?: string[];
}
export type Difficulty = "easy" | "medium" | "hard";
export interface RouteCase { id: string; message: string; difficulty: Difficulty; gold: RouteGold; note?: string }
export interface RouteCaseFile { fixture: string; vocabulary: string; version: number; author?: string; notes?: string; cases: RouteCase[] }

/** `hit` is null when the level is not scored for the case (beyond the intent of a question case). */
export interface LevelScore { gold: string | string[] | null; got?: string | string[]; hit: boolean | null }
export type ScoredLevel = "intent" | "space" | "kind" | "nodes";

export interface TranslationScore {
  output: Translation;
  goldOps: number;
  producedOps: number;
  matched: number;
  precision: number | null;
  recall: number | null;
  /** Gold asks a question: did the translator ask one? */
  question: boolean | null;
  /** Gold intent is `answer`: did the translator answer? */
  answer: boolean | null;
  problems: OpProblem[];
}

export interface RouteCaseResult {
  id: string;
  difficulty: Difficulty;
  message: string;
  levels: Record<ScoredLevel, LevelScore>;
  routed: boolean;
  status: JudgmentStatus;
  calls: number;
  route: Route;
  translation?: TranslationScore;
}

export interface Rate { hit: number; total: number; rate: number | null }

export interface RouteEvalReport {
  fixture: string;
  order: RouteOrder;
  model: string;
  translateModel?: string;
  cases: RouteCaseResult[];
  totals: {
    cases: number;
    byLevel: Record<ScoredLevel, Rate>;
    byDifficulty: Record<string, Rate>;
    routed: Rate;
    status: Record<JudgmentStatus, number>;
    meanCalls: number;
    translation?: {
      precision: number | null;
      recall: number | null;
      question: Rate;
      answer: Rate;
      errors: number;
      problems: { errors: number; warnings: number };
    };
  };
}

const QUESTION_INTENTS = new Set(["question", "unclear"]);
const rate = (hit: number, total: number): Rate => ({ hit, total, rate: total ? hit / total : null });

/**
 * Per-level scores of a route against gold. Intent is exact. A question case (gold intent `question`) scores only
 * its intent. Space and kind are exact. A null gold space (an addition at the root, which no section names) matches
 * a route that chose no space or the root; the kind is then not scored when the route never reached it. A null gold
 * kind matches a route that never chose one. Nodes hit when the route's nodes meet the gold nodes; empty gold nodes
 * hit when the route picked none. `routed` holds when every scored level hits.
 */
export function scoreRoute(gold: RouteGold, r: Route): { levels: Record<ScoredLevel, LevelScore>; routed: boolean } {
  const question = QUESTION_INTENTS.has(gold.intent);
  const got = (v: string | undefined) => (v !== undefined ? { got: v } : {});
  const space: LevelScore = question ? { gold: gold.space, ...got(r.target.space), hit: null }
    : { gold: gold.space, ...got(r.target.space), hit: gold.space === null ? r.target.space === undefined || r.target.space === r.root : r.target.space === gold.space };
  const kindUnreached = gold.space === null && r.target.space === undefined && r.target.kind === undefined;
  const kind: LevelScore = question || (kindUnreached && gold.kind !== null) ? { gold: gold.kind, ...got(r.target.kind), hit: null }
    : { gold: gold.kind, ...got(r.target.kind), hit: gold.kind === null ? r.target.kind === undefined : r.target.kind === gold.kind };
  const nodes: LevelScore = question ? { gold: gold.nodes, got: r.target.nodes, hit: null }
    : { gold: gold.nodes, got: r.target.nodes, hit: gold.nodes.length ? r.target.nodes.some((n) => gold.nodes.includes(n)) : r.target.nodes.length === 0 };
  const levels: Record<ScoredLevel, LevelScore> = {
    intent: { gold: gold.intent, ...got(r.intent), hit: r.intent === gold.intent },
    space, kind, nodes,
  };
  return { levels, routed: Object.values(levels).every((l) => l.hit !== false) };
}

/** Share of the gold text's words (light plural strip) the produced text has; 1 when gold has none. */
export function tokenOverlap(gold: string, produced: string): number {
  const g = routeTokens(gold), p = routeTokens(produced);
  if (!g.size) return 1;
  let n = 0;
  for (const w of g) if (p.has(w)) n++;
  return n / g.size;
}

const text = (fields: Record<string, unknown>) => Object.values(fields).map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : "")).join(" ");

/**
 * A produced op matches a gold op when the op and its primary key agree: `id` for update and remove, `kind` for
 * add, `from` and `to` for link and unlink. Update field values and add titles must also share at least half of
 * the gold text's words.
 */
export function opMatches(gold: GoldOp, produced: Op): boolean {
  if (gold.op !== produced.op) return false;
  switch (gold.op) {
    case "update": {
      const p = produced as Extract<Op, { op: "update" }>;
      return p.id === gold.id && tokenOverlap(text(gold.fields), text(p.fields)) >= 0.5;
    }
    case "remove": return (produced as Extract<Op, { op: "remove" }>).id === gold.id;
    case "add": {
      const p = produced as Extract<Op, { op: "add" }>;
      return p.kind === gold.kind && tokenOverlap(gold.title, p.title) >= 0.5;
    }
    default: {
      const p = produced as Extract<Op, { op: "link" | "unlink" }>;
      return p.from === gold.from && p.to === gold.to;
    }
  }
}

/** One-to-one greedy matching of produced ops to gold ops, plus question and answer checks and `validateOps`. */
export function scoreTranslation(gold: RouteGold, out: Translation, template: RouteVocabularySource, g: Graph): TranslationScore {
  const goldOps = gold.ops ?? [];
  const produced = out.ops ?? [];
  const used = new Set<number>();
  let matched = 0;
  for (const go of goldOps) {
    const i = produced.findIndex((p, j) => !used.has(j) && opMatches(go, p));
    if (i >= 0) { used.add(i); matched++; }
  }
  return {
    output: out,
    goldOps: goldOps.length,
    producedOps: produced.length,
    matched,
    precision: produced.length ? used.size / produced.length : null,
    recall: goldOps.length ? matched / goldOps.length : null,
    question: gold.question !== undefined ? !!out.question?.trim() : null,
    answer: gold.intent === "answer" ? !!out.answer?.trim() : null,
    problems: produced.length ? validateOps(produced, template, g) : [],
  };
}

/**
 * A scripted System One that walks the chain to the gold target: intent, space and kind from gold (`none` when
 * null); at the node level the first gold node offered, else `new` when offered and the gold adds or names nodes,
 * else `none`; the shortlist and anchor levels likewise pick a gold node or `none`; further gold nodes through the follow-ups
 * while any remain among the offered candidates. One instance per routed message; works for both orders.
 */
export function oracleSystemOne(gold: RouteGold): SystemOne {
  const offered: string[] = [];
  const picked = new Set<string>();
  const pick = (q: S1Question) => {
    const keys = q.type === "choice" ? Object.keys(q.criteria) : [];
    const hit = gold.nodes.find((n) => keys.includes(n) && !picked.has(n));
    if (hit) picked.add(hit);
    return { keys, hit };
  };
  return scriptedSystemOne({
    "route.intent": gold.intent,
    "route.space": gold.space ?? ROUTE_NONE,
    "route.kind": gold.kind ?? ROUTE_NONE,
    "route.node": (_s, q) => {
      const { keys, hit } = pick(q);
      offered.push(...keys);
      return hit ?? ((gold.intent === "add" || gold.nodes.length) && keys.includes(ROUTE_NEW) ? ROUTE_NEW : ROUTE_NONE);
    },
    "route.shortlist": (_s, q) => { const { keys, hit } = pick(q); offered.push(...keys); return hit ?? ROUTE_NONE; },
    "route.anchor": (_s, q) => pick(q).hit ?? ROUTE_NONE,
    "route.more": () => (gold.nodes.some((n) => offered.includes(n) && !picked.has(n)) ? "yes" : "no"),
    "route.nodes": (_s, q) => pick(q).hit ?? ROUTE_NONE,
  }, "oracle");
}

export interface RouteEvalContext {
  graph: Graph;
  template: RouteVocabularySource;
  /** One provider for every case, or one per case (the oracle). */
  s1: SystemOne | ((c: RouteCase) => SystemOne);
  translator?: Translator;
  options?: RouteOptions;
  slice?: RouteSliceOptions;
  /** Cases in flight at once. Default 1. */
  concurrency?: number;
  translate?: AskOptions;
}

/** Routes (and, with a translator, translates) every case and scores it against gold. */
export async function evalRoute(file: RouteCaseFile, ctx: RouteEvalContext): Promise<RouteEvalReport> {
  const run = limiter(ctx.concurrency ?? 1);
  let model = typeof ctx.s1 === "function" ? "oracle" : ctx.s1.model;
  const cases = await Promise.all(file.cases.map((c) => run(async (): Promise<RouteCaseResult> => {
    const s1 = typeof ctx.s1 === "function" ? ctx.s1(c) : ctx.s1;
    const r = await route(ctx.graph, ctx.template, c.message, s1, ctx.options);
    if (r.provenance.model) model = r.provenance.model;
    const { levels, routed } = scoreRoute(c.gold, r);
    let translation: TranslationScore | undefined;
    if (ctx.translator && ctx.translator.mode !== "off") {
      const slice = routeSlice(ctx.graph, r, ctx.slice);
      const out = await ctx.translator.translate({ message: c.message, route: r, slice, vocabulary: routeVocabulary(ctx.template, r, slice) }, ctx.translate);
      translation = scoreTranslation(c.gold, out, ctx.template, ctx.graph);
    }
    return { id: c.id, difficulty: c.difficulty, message: c.message, levels, routed, status: r.status, calls: r.calls, route: r, ...(translation && { translation }) };
  })));

  const LEVELS: ScoredLevel[] = ["intent", "space", "kind", "nodes"];
  const byLevel = Object.fromEntries(LEVELS.map((l) => {
    const scored = cases.filter((c) => c.levels[l].hit !== null);
    return [l, rate(scored.filter((c) => c.levels[l].hit).length, scored.length)];
  })) as Record<ScoredLevel, Rate>;
  const byDifficulty = Object.fromEntries([...new Set(cases.map((c) => c.difficulty))].sort().map((d) => {
    const of = cases.filter((c) => c.difficulty === d);
    return [d, rate(of.filter((c) => c.routed).length, of.length)];
  }));
  const status: Record<JudgmentStatus, number> = { confident: 0, review: 0, unknown: 0 };
  for (const c of cases) status[c.status]++;

  const ts = cases.flatMap((c) => (c.translation ? [c.translation] : []));
  const sum = (f: (t: TranslationScore) => number) => ts.reduce((s, t) => s + f(t), 0);
  const produced = sum((t) => t.producedOps), goldOps = sum((t) => t.goldOps), matched = sum((t) => t.matched);
  const flagged = (k: "question" | "answer") => rate(ts.filter((t) => t[k] === true).length, ts.filter((t) => t[k] !== null).length);
  const translation = ts.length ? {
    precision: produced ? sum((t) => (t.precision ?? 0) * t.producedOps) / produced : null,
    recall: goldOps ? matched / goldOps : null,
    question: flagged("question"),
    answer: flagged("answer"),
    errors: ts.filter((t) => t.output.error).length,
    problems: { errors: sum((t) => t.problems.filter((p) => p.level === "error").length), warnings: sum((t) => t.problems.filter((p) => p.level === "warning").length) },
  } : undefined;

  return {
    fixture: file.fixture,
    order: ctx.options?.order ?? "shortlist-first",
    model,
    ...(ctx.translator && ctx.translator.mode !== "off" && { translateModel: ctx.translator.model }),
    cases,
    totals: {
      cases: cases.length,
      byLevel,
      byDifficulty,
      routed: rate(cases.filter((c) => c.routed).length, cases.length),
      status,
      meanCalls: cases.length ? cases.reduce((s, c) => s + c.calls, 0) / cases.length : 0,
      ...(translation && { translation }),
    },
  };
}
