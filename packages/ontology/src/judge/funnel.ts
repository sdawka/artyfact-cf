import { hashOf } from "../canon.ts";
import type { Finding, Level } from "../evaluate/findings.ts";
import type { Graph, GraphNode } from "../graph/graph.ts";
import type { Question, Slice } from "../meta/schema.ts";
import { S1Error } from "./provider.ts";
import { answerKey, combine, decide, harmOf, passFromOf, policyEntry, readAnswer, scoreConfidence, type Decision } from "./policy.ts";
import { pairScore, termsAcross } from "./prefilter.ts";
import { CHECK_PREFIX } from "../evaluate/checks.ts";
import { PAIR_PREFIX, PAIR_SEPARATOR } from "./probe.ts";
import { buildSlice, pairOf, type SliceState } from "./slice.ts";
import type { Answer, AskOptions, JudgmentStep, Provenance, S1Question, SystemOne, Thresholds } from "./types.ts";
import { toWire } from "./wire.ts";

/**
 * The judgment funnel: semantic candidates become stage-1 items, items about the same subject and slice share one
 * provider call, and confident answers spawn follow-ups (`next`) over the same subject, its members, member pairs,
 * sections or cross-section pairs. A chain of `self` follow-ups refines one finding; every other `over` opens a new
 * finding whose path starts with its parent's. Pre-filters only order and cap pairs and pick terms.
 */

export interface Limits {
  maxRounds: number;
  maxCalls: number;
  maxPairsPerSet: number;
  maxSections: number;
  maxCrossPairs: number;
  maxTerms: number;
  maxExplanations: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxRounds: 6, maxCalls: 500, maxPairsPerSet: 6, maxSections: 12, maxCrossPairs: 10, maxTerms: 5, maxExplanations: 10,
};

export function limitsOf(l: Partial<Limits> = {}): Limits {
  const out = { ...DEFAULT_LIMITS, ...l };
  for (const [k, v] of Object.entries(out)) if (!Number.isInteger(v) || v < 0) throw new RangeError(`limits.${k} must be a non-negative integer`);
  return out;
}

/** `companion`: a non-polarity `batchWith` companion whose answer did not pass and so became a finding of its own. */
export type Stage = "entry" | "companion" | "self" | "members" | "pairs" | "sections" | "crossPairs" | "terms";

/** One answered question. `nav` steps (dynamic-choice picks) are on the path but never describe the finding. */
export interface Step {
  question: Question;
  subject: string;
  decision: Decision;
  nav: boolean;
  state: SliceState;
  provenance: Provenance;
  /** Score questions: mass on the chosen side of the pass boundary. */
  banded?: number;
  /** The polarity partner, decided from the same combined answer; its own `next` entries are followed too. */
  partner?: { question: Question; decision: Decision };
}

/** A finding under construction: its entry item, the steps answered for it, and the findings it spawned. */
export interface Track {
  base: Finding;
  subject: string;
  prefix: JudgmentStep[];
  steps: Step[];
  entry: Item;
  parents: Track[];
  children: Track[];
  /** Its entry item was cut by `maxCalls` or `maxRounds` before being asked. */
  budget?: boolean;
  /** A queued follow-up of this finding was cut by the budget; it settled on an earlier step. */
  truncated?: boolean;
  /** A duplicate candidate (same question and state as another entry in its batch) takes that track's answers. */
  mirror?: Track;
}

export interface Item {
  track: Track;
  question: Question;
  subject: string;
  kind?: string;
  /** For a pair drawn under a set or root: that node's kind, whose own `pairs` criterion words the question. */
  parentKind?: string;
  state: SliceState;
  /** Resolved options of a `choicesFrom` question. */
  choices?: string[];
  key: string;
  stage: Stage;
  round: number;
  /** For a companion item: the track of the item that brought it, which shares its follow-ups. */
  via?: Track;
}

export interface Batch { subject: string; state: SliceState; items: Item[]; companions: Question[]; parentKind?: string }

export interface FunnelContext {
  g: Graph;
  byId: Map<string, GraphNode>;
  children: Map<string, GraphNode[]>;
  catalogue: Map<string, Question>;
  s1: SystemOne;
  t: Thresholds;
  ask?: AskOptions;
  limits: Limits;
  calls: number;
  gated: number;
  exhausted: boolean;
  /** Memo: `(question id, state hash, options)` to the track that asks it, so a doubly reachable item is asked once. */
  seen: Map<string, Track>;
  tracks: Track[];
  /** Statement fields, the probe's `texts`: a node is texted, so a member or section, when one of them is non-empty. */
  texts: string[];
  /** Per root: its sections, most relevant first, capped at `maxSections`. */
  sections: Map<string, string[]>;
}

export const SEMANTIC = "semantic:";

/** Default statement fields, as in `semantic.probe`. */
export const DEFAULT_TEXTS: readonly string[] = ["description"];

/** The statement fields a template's `semantic.probe` pack declares as `probeText` facts; undefined without the pack. */
export function probeTextsOf(rules: readonly { id: string; source: string }[]): string[] | undefined {
  const pack = rules.find((r) => r.id === "semantic.probe");
  if (!pack) return undefined;
  const fields = [...pack.source.matchAll(/^\s*probeText\(("(?:[^"\\]|\\.)*")\)\.\s*$/gm)].map((m) => JSON.parse(m[1]!) as string).filter(Boolean);
  return [...new Set(fields)];
}

export function funnelContext(g: Graph, catalogue: Map<string, Question>, s1: SystemOne, t: Thresholds, limits: Limits, ask?: AskOptions,
  texts: readonly string[] = DEFAULT_TEXTS): FunnelContext {
  const byId = new Map<string, GraphNode>();
  for (const n of g.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const children = new Map<string, GraphNode[]>();
  for (const n of byId.values()) {
    if (n.parent === undefined) continue;
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent)!.push(n);
  }
  for (const c of children.values()) c.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    g, byId, children, catalogue, s1, t, ask, limits, calls: 0, gated: 0, exhausted: false, seen: new Map(), tracks: [],
    texts: [...texts], sections: new Map(),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** A node's statement text: its title and description. */
export const nodeText = (n: GraphNode | undefined): string => (n ? [str(n.fields.title), str(n.fields.description)].filter(Boolean).join(". ") : "");
const nonEmpty = (v: unknown): boolean => (typeof v === "string" ? v !== "" : Array.isArray(v) && v.some((x) => typeof x === "string" && x !== ""));
/** A node with a non-empty statement field, the same test as the probe's `probeTexted`. A title alone does not count. */
const texted = (ctx: FunnelContext, n: GraphNode) => ctx.texts.some((f) => nonEmpty(n.fields[f]));
/** A node's statement fields joined, for term spotting. */
const statementOf = (ctx: FunnelContext, n: GraphNode): string =>
  ctx.texts.flatMap((f) => { const v = n.fields[f]; return typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; })
    .filter(Boolean).join(". ");

/**
 * A root's sections: its texted direct children, ordered by pre-filter relevance (the sum of `pairScore` against the
 * other sections, so a section that clashes with or repeats others comes first), then id, and capped at
 * `maxSections`. Sections beyond the cap are counted in `gated` once per root.
 */
export function sectionsOf(ctx: FunnelContext, root: string): string[] {
  const known = ctx.sections.get(root);
  if (known) return known;
  const all = (ctx.children.get(root) ?? []).filter((n) => texted(ctx, n));
  const view = (n: GraphNode) => ({ title: n.fields.title, description: statementOf(ctx, n) });
  const scored = all.map((n) => ({ id: n.id, score: all.reduce((sum, o) => (o === n ? sum : sum + pairScore(view(n), view(o))), 0) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (scored.length > ctx.limits.maxSections) ctx.gated += scored.length - ctx.limits.maxSections;
  const ids = scored.slice(0, ctx.limits.maxSections).map((x) => x.id);
  ctx.sections.set(root, ids);
  return ids;
}

const pairSubject = (a: string, b: string) => (a < b ? `${a}${PAIR_SEPARATOR}${b}` : `${b}${PAIR_SEPARATOR}${a}`);

function kindOf(ctx: FunnelContext, subject: string): string | undefined {
  const pair = pairOf(subject, (id) => ctx.byId.has(id));
  return ctx.byId.get(pair ? pair[0] : subject)?.kind;
}

/** Step answers on a track (path and own steps) that are direct children of the track's subject: picked sections. */
function pickedChildren(ctx: FunnelContext, track: Track): string[] {
  const kids = new Set((ctx.children.get(track.subject) ?? []).map((n) => n.id));
  const answers = [...track.prefix.map((s) => s.answer), ...track.steps.map((s) => s.decision.answer)];
  const out: string[] = [];
  for (const a of answers) if (a !== undefined && kids.has(a) && !out.includes(a)) out.push(a);
  return out;
}

function memberIds(ctx: FunnelContext, state: SliceState, subject: string): string[] {
  const nodes = state.members ? state.members.map((m) => ctx.byId.get(m.id)).filter((n): n is GraphNode => !!n) : ctx.children.get(subject) ?? [];
  return nodes.filter((n) => texted(ctx, n)).map((n) => n.id);
}

/** Options for a `choicesFrom` question: the slice members, or the subject's sections (see `sectionsOf`) not yet picked, in the same order. */
function resolveChoices(ctx: FunnelContext, q: Question, state: SliceState, subject: string, track: Track): string[] | undefined {
  if (!q.choicesFrom) return undefined;
  if (q.choicesFrom === "members") return memberIds(ctx, state, subject);
  const picked = new Set(pickedChildren(ctx, track));
  return sectionsOf(ctx, subject).filter((id) => !picked.has(id));
}

function makeItem(ctx: FunnelContext, track: Track, q: Question, subject: string, text: string,
  from: { question: string; answer: string } | undefined, stage: Stage, round: number, slice: Slice = q.slice, parentKind?: string): Item {
  const state = buildSlice(ctx.g, subject, slice, { rule: q.id, text, ...(from && { from }) });
  const choices = resolveChoices(ctx, q, state, subject, track);
  // The wording kind is part of the key: the same pair worded under another parent kind is a different question.
  const key = hashOf([q.id, hashOf(state), choices ?? null, ...(parentKind !== undefined ? [parentKind] : [])]);
  const kind = kindOf(ctx, subject);
  return {
    track, question: q, subject, ...(kind !== undefined && { kind }), ...(parentKind !== undefined && { parentKind }),
    state, ...(choices && { choices }), key, stage, round,
  };
}

function newTrack(ctx: FunnelContext, base: Finding, subject: string, prefix: JudgmentStep[], parent?: Track): Track {
  const track: Track = { base, subject, prefix, steps: [], entry: undefined as unknown as Item, parents: parent ? [parent] : [], children: [] };
  parent?.children.push(track);
  ctx.tracks.push(track);
  return track;
}

/** A `pair.` candidate carries its second node in the text column; the judged finding's subject is `a|b`. */
const subjectOf = (rule: string, f: Finding, text: string): string =>
  rule.startsWith(PAIR_PREFIX) && text !== "" ? `${f.subject ?? ""}${PAIR_SEPARATOR}${text}` : f.subject ?? "";

export interface Seeded { items: Item[]; fixed: Finding[]; passthrough: Finding[] }

/**
 * Stage 1: one item per semantic candidate with a catalogue entry. A candidate without one is settled at once as
 * `unknown` with provider `off`; non-semantic findings pass through.
 */
export function seed(findings: Finding[], ctx: FunnelContext): Seeded {
  const out: Seeded = { items: [], fixed: [], passthrough: [] };
  for (const input of findings) {
    if (!input.rule.startsWith(SEMANTIC)) { out.passthrough.push(input); continue; }
    const rule = input.rule.slice(SEMANTIC.length);
    const text = String(input.derivation.tuple[2] ?? "");
    const subject = subjectOf(rule, input, text);
    const f: Finding = subject === (input.subject ?? "") ? input : { ...input, subject };
    const q = ctx.catalogue.get(rule);
    if (!q) {
      const state = buildSlice(ctx.g, subject, defaultSlice, { rule, text });
      out.fixed.push({
        ...f, level: "info", judgment: { question: rule, status: "unknown", ...checkOf(rule) },
        provenance: { provider: "off", model: "off", stateHash: hashOf(state), questionHash: hashOf(null), thresholds: ctx.t },
      });
      continue;
    }
    // Every candidate is judged, even one identical to another; follow-ups are memoised.
    const track = newTrack(ctx, f, subject, []);
    const item = makeItem(ctx, track, q, subject, text, undefined, "entry", 1);
    track.entry = item;
    if (!ctx.seen.has(item.key)) ctx.seen.set(item.key, track);
    out.items.push(item);
  }
  return out;
}
const defaultSlice: Slice = { parents: true, hops: 0, direction: "out", children: false, textCap: 600 };

/**
 * Whole-scope roots (stage-1 tracks whose question, through its follow-ups, walks `sections` or `crossPairs`) get one `term.usage` item per
 * term the pre-filter finds in at least two of their sections, capped at `maxTerms`. Only when the catalogue has
 * `term.usage`.
 */
export function termItems(ctx: FunnelContext, roots: Track[]): Item[] {
  const q = ctx.catalogue.get("term.usage");
  if (!q) return [];
  const out: Item[] = [];
  const done = new Set<string>();
  for (const root of roots) {
    if (done.has(root.subject) || !walksSections(root.entry.question, ctx.catalogue)) continue;
    done.add(root.subject);
    const sections = sectionsOf(ctx, root.subject).map((id) => ctx.byId.get(id)!)
      .map((s) => ({ id: s.id, texts: [s, ...descendants(ctx, s.id)].map((n) => statementOf(ctx, n)) }));
    const spreads = termsAcross(sections);
    if (spreads.length > ctx.limits.maxTerms) ctx.gated += spreads.length - ctx.limits.maxTerms;
    for (const { term } of spreads.slice(0, ctx.limits.maxTerms)) {
      const base: Finding = { ...root.base, rule: `${SEMANTIC}${q.id}`, level: "info", message: `Term "${term}" is used across sections of ${root.subject}.` };
      const track = newTrack(ctx, base, root.subject, []);
      const item = makeItem(ctx, track, q, root.subject, term, undefined, "terms", 1);
      track.entry = item;
      if (ctx.seen.has(item.key)) { ctx.tracks.pop(); continue; }
      ctx.seen.set(item.key, track);
      out.push(item);
    }
  }
  return out;
}

/** Whether a question's follow-ups, followed transitively, ever walk `sections` or `crossPairs`. */
function walksSections(q: Question, catalogue: Map<string, Question>): boolean {
  const seen = new Set<string>();
  for (const stack = [q]; stack.length;) {
    const x = stack.pop()!;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    for (const n of x.next ?? []) {
      if (n.over === "sections" || n.over === "crossPairs") return true;
      const y = catalogue.get(n.ask);
      if (y) stack.push(y);
    }
  }
  return false;
}

function descendants(ctx: FunnelContext, id: string): GraphNode[] {
  const out: GraphNode[] = [];
  const seen = new Set([id]);
  for (let frontier = [id]; frontier.length;) {
    const next: string[] = [];
    for (const p of frontier) for (const c of ctx.children.get(p) ?? []) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); next.push(c.id); }
    frontier = next;
  }
  return out;
}

/**
 * Items about the same subject with deep-equal slice state (the candidate's rule aside) share one call; each item's
 * `batchWith` companions ride along. The call's state names every question in `candidate.rule`, so a batch of one
 * sends exactly the item's own state.
 */
export function group(items: Item[], ctx: FunnelContext): Batch[] {
  const batches = new Map<string, Batch>();
  for (const it of items) {
    const { rule: _rule, ...cand } = it.state.candidate;
    const key = hashOf([it.subject, { ...it.state, candidate: cand }, it.parentKind ?? null]);
    let b = batches.get(key);
    if (!b) batches.set(key, b = { subject: it.subject, state: it.state, items: [], companions: [], ...(it.parentKind !== undefined && { parentKind: it.parentKind }) });
    const twin = b.items.find((x) => x.question.id === it.question.id);
    if (!twin) b.items.push(it);
    // A duplicate candidate (same question, subject and state) is asked once; its finding mirrors the first one's.
    else if (it.track !== twin.track && !it.track.steps.length) it.track.mirror = twin.track;
  }
  for (const b of batches.values()) {
    const asked = new Set(b.items.map((i) => i.question.id));
    for (const it of b.items) {
      for (const c of it.question.batchWith ?? []) {
        const q = ctx.catalogue.get(c);
        if (q && !asked.has(q.id)) { asked.add(q.id); b.companions.push(q); }
      }
    }
    const ids = [...b.items.map((i) => i.question.id), ...b.companions.map((q) => q.id)];
    if (ids.length > 1) b.state = { ...b.state, candidate: { ...b.state.candidate, rule: ids.join(",") } };
  }
  return [...batches.values()];
}

const errorOf = (e: unknown): NonNullable<Provenance["error"]> =>
  e instanceof S1Error ? { name: e.name, code: e.code, message: e.message, ...(e.status !== undefined && { status: e.status }) }
    : { name: (e as Error)?.name ?? "Error", message: String((e as Error)?.message ?? e) };

interface Asked { answer?: Answer; provenance: Omit<Provenance, "stateHash" | "questionHash" | "thresholds" | "round" | "stage">; stateHash: string }

/** The yes-no companion of opposite polarity whose answer is combined with `q`'s (for example allHold with inconsistent). */
export function polarityPartner(q: Question, ctx: FunnelContext): Question | undefined {
  if (q.answer !== "yes-no") return undefined;
  return (q.batchWith ?? []).map((c) => ctx.catalogue.get(c))
    .find((c): c is Question => !!c && c.answer === "yes-no" && answerKey(c.benign) !== answerKey(q.benign));
}

/** A passing answer stands for no defect, even when the question declares one. */
/** The family a question asks about: its own `defect`, else the root of its policy entries' defects. */
export function familyDefect(q: Question): string | undefined {
  if (q.defect !== undefined) return q.defect;
  const own = q.policy.find((p) => p.defect !== undefined)?.defect;
  return own?.split(".")[0];
}

/**
 * A passing answer stands for no defect, even when the question declares one. A `review` answer always carries a
 * defect, the question's family when the answer itself names none (a benign answer at 0.7 is still a doubt about
 * that family), so detection can match it.
 */
const defectFor = (q: Question) => (d: Decision): Decision => {
  if (d.level === "pass" && d.defect !== undefined) {
    const { defect: _defect, ...rest } = d;
    return rest;
  }
  if (d.status === "review" && d.defect === undefined) {
    const family = familyDefect(q);
    if (family !== undefined) return { ...d, defect: family };
  }
  return d;
};

/** The combined side as a decision for one question of a polarity pair: harmful takes its non-benign answer. */
function sideOf(q: Question, harmful: boolean, status: Decision["status"], confidence: number, kind: string | undefined, probabilities?: Record<string, number>): Decision {
  const benign = answerKey(q.benign);
  const answer = harmful ? (benign === "yes" ? "no" : "yes") : benign;
  const entry = policyEntry(q, answer, kind);
  const st = entry ? status : "unknown";
  const level: Level = st === "confident" ? (entry!.level as Level) : st === "review" ? "review" : "info";
  const defect = entry?.defect ?? q.defect;
  return defectFor(q)({ status: st, level, answer, confidence, ...(probabilities && { probabilities }), ...(defect !== undefined && { defect }) });
}

/**
 * `decide`, plus the banded confidence of a score, plus `combine` with a polarity partner. Each side's harm is read
 * against its own `benign` (`set.allHold` is benign at yes, `set.inconsistent` at no), and the combined side is mapped
 * back to each question's own answer key, so both questions' `next` entries can follow it.
 */
export function decideItem(q: Question, a: Answer | undefined, ctx: FunnelContext, kind?: string, partner?: { q: Question; a?: Answer }):
  { decision: Decision; banded?: number; partner?: Decision } {
  const d = defectFor(q)(decide(q, a, ctx.t, kind));
  if (q.answer === "score" && d.probabilities && d.answer !== undefined) {
    return { decision: d, banded: scoreConfidence(d.probabilities, passFromOf(q, kind), Number(d.answer)) };
  }
  if (!partner) return { decision: d };
  const pr = readAnswer(partner.q, partner.a);
  const h = combine(harmOf(q, readAnswer(q, a)), harmOf(partner.q, pr), ctx.t);
  if (h.status === "unknown" || h.harmful === undefined) {
    return { decision: { status: "unknown", level: "info", confidence: h.confidence, ...(d.probabilities && { probabilities: d.probabilities }) } };
  }
  return {
    decision: sideOf(q, h.harmful, h.status, h.confidence, kind, d.probabilities),
    partner: sideOf(partner.q, h.harmful, h.status, h.confidence, kind, pr?.probabilities),
  };
}

/**
 * One provider call for the batch (its first call is already counted in `ctx.calls`). A `bad-response` for a
 * multi-question batch is retried one question at a time, each a call of its own within `maxCalls`; questions the
 * budget cuts are left unanswered and their items are returned in `cut`.
 */
export async function askBatch(batch: Batch, ctx: FunnelContext, round: number): Promise<{ judged: [Item, Step][]; cut: Item[] }> {
  const kind = kindOf(ctx, batch.subject);
  const questions: [Question, string[] | undefined][] = [
    ...batch.items.map((i) => [i.question, i.choices] as [Question, string[] | undefined]),
    ...batch.companions.map((q) => [q, resolveChoices(ctx, q, batch.state, batch.subject, batch.items[0]!.track)] as [Question, string[] | undefined]),
  ];
  const wire = (q: Question, c?: string[]): S1Question => toWire(q, kind, c, batch.parentKind);
  const asked = new Map<string, Asked>();
  const unasked = new Set<string>();
  const sent = hashOf(batch.state);
  try {
    const reply = await ctx.s1.ask(batch.state, Object.fromEntries(questions.map(([q, c]) => [q.id, wire(q, c)])), ctx.ask);
    for (const [q] of questions) {
      asked.set(q.id, { answer: reply.answers[q.id], stateHash: sent, provenance: { provider: reply.provider, model: reply.model, usage: reply.usage, batch: { size: questions.length } } });
    }
  } catch (e) {
    if (e instanceof S1Error && e.code === "bad-response" && questions.length > 1) {
      for (const [q, c] of questions) {
        if (ctx.calls >= ctx.limits.maxCalls) { unasked.add(q.id); ctx.exhausted = true; continue; }
        ctx.calls++;
        const own = batch.items.find((i) => i.question.id === q.id)?.state ?? batch.state;
        try {
          const reply = await ctx.s1.ask(own, { [q.id]: wire(q, c) }, ctx.ask);
          asked.set(q.id, { answer: reply.answers[q.id], stateHash: hashOf(own), provenance: { provider: reply.provider, model: reply.model, usage: reply.usage, batch: { size: 1, split: true } } });
        } catch (e2) {
          asked.set(q.id, { stateHash: hashOf(own), provenance: { provider: e2 instanceof S1Error && e2.code === "off" ? "off" : "error", model: ctx.s1.model, error: errorOf(e2), batch: { size: 1, split: true } } });
        }
      }
    } else {
      const provider = e instanceof S1Error && e.code === "off" ? "off" : "error";
      for (const [q] of questions) asked.set(q.id, { stateHash: sent, provenance: { provider, model: ctx.s1.model, error: errorOf(e), ...(questions.length > 1 && { batch: { size: questions.length } }) } });
    }
  }

  const judged: [Item, Step][] = [];
  const cut: Item[] = [];
  for (const item of batch.items) {
    const q = item.question;
    const got = asked.get(q.id);
    if (!got || unasked.has(q.id)) { cut.push(item); continue; }
    const p = polarityPartner(q, ctx);
    const partner = p && asked.has(p.id) ? { q: p, a: asked.get(p.id)!.answer } : undefined;
    const { decision, banded, partner: side } = got.provenance.error && !partner ? { decision: { status: "unknown", level: "info" } as Decision, banded: undefined, partner: undefined }
      : decideItem(q, got.answer, ctx, item.kind, partner);
    const provenance: Provenance = {
      provider: got.provenance.provider, model: got.provenance.model, stateHash: got.stateHash, questionHash: hashOf(q), thresholds: ctx.t,
      ...(got.provenance.usage && { usage: got.provenance.usage }),
      ...(got.provenance.error && { error: got.provenance.error }),
      round, stage: item.stage,
      ...(got.provenance.batch && { batch: got.provenance.batch }),
    };
    const step: Step = {
      question: q, subject: item.subject, decision, nav: !!q.choicesFrom, state: item.state, provenance,
      ...(banded !== undefined && { banded }), ...(side && p && { partner: { question: p, decision: side } }),
    };
    item.track.steps.push(step);
    judged.push([item, step]);
  }

  // A companion that is no item's polarity partner is a question in its own right: a harmful or doubtful answer
  // becomes a finding of its own (cloned from the item that brought it), and its `next` entries are followed.
  const partners = new Set(batch.items.map((i) => polarityPartner(i.question, ctx)?.id).filter((x): x is string => !!x));
  for (const c of batch.companions) {
    const got = asked.get(c.id);
    if (partners.has(c.id) || !got || got.provenance.error) continue;
    const { decision } = decideItem(c, got.answer, ctx, kind);
    if (decision.status === "unknown" || decision.level === "pass") continue;
    const owner = batch.items.find((i) => i.question.batchWith?.includes(c.id)) ?? batch.items[0]!;
    const base: Finding = { ...owner.track.base, rule: `${SEMANTIC}${c.id}`, level: "info", message: `${c.id} for ${owner.subject}, asked with ${owner.question.id}.` };
    delete base.judgment; delete base.provenance;
    const track = newTrack(ctx, base, owner.subject, []);
    const state = { ...owner.state, candidate: { ...owner.state.candidate, rule: c.id } };
    const choices = resolveChoices(ctx, c, state, owner.subject, track);
    const item: Item = {
      track, question: c, subject: owner.subject, ...(owner.kind !== undefined && { kind: owner.kind }), state, ...(choices && { choices }),
      key: hashOf([c.id, hashOf(state), choices ?? null]), stage: "companion", round, via: owner.track,
    };
    track.entry = item;
    if (ctx.seen.has(item.key)) { ctx.tracks.pop(); continue; }
    ctx.seen.set(item.key, track);
    const provenance: Provenance = {
      provider: got.provenance.provider, model: got.provenance.model, stateHash: got.stateHash, questionHash: hashOf(c), thresholds: ctx.t,
      ...(got.provenance.usage && { usage: got.provenance.usage }), round, stage: "companion",
      ...(got.provenance.batch && { batch: got.provenance.batch }),
    };
    const step: Step = { question: c, subject: owner.subject, decision, nav: !!c.choicesFrom, state, provenance };
    track.steps.push(step);
    judged.push([item, step]);
  }
  return { judged, cut };
}

const RANK = { confident: 2, review: 1, unknown: 0 } as const;

/**
 * A `next` entry fires when the step's status reaches `minStatus` (default confident) and the answer matches: the
 * answer it names, a score at most `maxScore` (with no `answer`, any such score that does not pass), or, naming
 * neither, any non-benign answer that does not pass.
 */
/**
 * The status a step needs before its `next` entry fires. A navigation question (`choicesFrom`: its answer is a
 * subject id) fires at `review` by default: a pick just under the confident threshold still names where to look. A
 * declared `minStatus` always wins; absent, other questions fire at `confident`.
 */
export const minStatusOf = (q: Question, n: NonNullable<Question["next"]>[number]): "confident" | "review" =>
  n.minStatus ?? (q.choicesFrom ? "review" : "confident");

function fires(q: Question, d: Decision, n: NonNullable<Question["next"]>[number]): boolean {
  if (d.answer === undefined || RANK[d.status] < RANK[minStatusOf(q, n)]) return false;
  // A passing step never narrows: a score that passes under the kind's `passFrom` does not fire a `maxScore` entry.
  if (d.level === "pass" && n.answer === undefined) return false;
  if (n.answer !== undefined && answerKey(n.answer) !== d.answer) return false;
  if (n.maxScore !== undefined && !(q.answer === "score" && Number(d.answer) <= n.maxScore)) return false;
  return n.answer !== undefined || n.maxScore !== undefined || d.answer !== answerKey(q.benign);
}

const toStep = (s: Step): JudgmentStep => ({
  question: s.question.id, subject: s.subject, status: s.decision.status,
  ...(s.decision.answer !== undefined && { answer: s.decision.answer, confidence: s.decision.confidence }),
  ...(s.decision.defect !== undefined && { defect: s.decision.defect }),
  ...(s.banded !== undefined && { bandedConfidence: s.banded }),
});

export const pathOf = (t: Track): JudgmentStep[] => [...t.prefix, ...t.steps.map(toStep)];

/** Orders candidate pairs by the pre-filters (modal clash, then near-duplicate), ties by subject, and caps them. */
function rankPairs(ctx: FunnelContext, pairs: [string, string][], cap: number): [string, string][] {
  const uniq = new Map<string, [string, string]>();
  for (const [a, b] of pairs) if (a !== b) uniq.set(pairSubject(a, b), a < b ? [a, b] : [b, a]);
  const scored = [...uniq].map(([s, p]) => ({ s, p, score: pairScore(ctx.byId.get(p[0])?.fields ?? {}, ctx.byId.get(p[1])?.fields ?? {}) }))
    .sort((x, y) => y.score - x.score || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0));
  if (scored.length > cap) ctx.gated += scored.length - cap;
  return scored.slice(0, cap).map((x) => x.p);
}

/**
 * Follow-ups of one judged step: every `next` entry that fires, resolved over `over`. `self` continues the same
 * finding; the others open new findings whose base clones the parent's derivation and whose path starts with the
 * parent's. An item already asked or queued (same question, state and options) is not asked again; a new parent is
 * linked to the existing finding instead.
 *
 * A polarity partner's own `next` entries follow the combined answer too. `fired` holds the `ask|over` pairs already
 * followed for this item and the companions it brought, so a polarity pair (or an item and its companion) that lead to
 * the same follow-up walk it once, from the first question that fires it.
 */
export function expand(item: Item, step: Step, ctx: FunnelContext, round: number, fired: Set<string> = new Set()): Item[] {
  const out: Item[] = [];
  const entries = [
    ...(item.question.next ?? []).map((n) => [item.question, step.decision, n] as const),
    ...(step.partner ? (step.partner.question.next ?? []).map((n) => [step.partner!.question, step.partner!.decision, n] as const) : []),
  ];
  type Entry = Pick<NonNullable<Question["next"]>[number], "ask" | "over">;

  /** Follows one entry. `fallback`: the navigation pick failed, so pairs are taken from the pre-filters alone. */
  const follow = (q: Question, d: Decision, n: Entry, fallback = false): void => {
    const ask = ctx.catalogue.get(n.ask);
    if (!ask) return;
    const over = n.over ?? "self";
    if (fired.has(`${ask.id}|${over}`)) return;
    fired.add(`${ask.id}|${over}`);
    const from = { question: q.id, answer: d.answer ?? "unknown" };
    if (over === "self") {
      const it = makeItem(ctx, item.track, ask, item.subject, item.state.candidate.text, from, "self", round, ask.slice, item.parentKind);
      if (ctx.seen.has(it.key)) return;
      ctx.seen.set(it.key, item.track);
      out.push(it);
      return;
    }
    const spawn = (subject: string, text: string, slice: Slice = ask.slice) => {
      const base: Finding = {
        ...item.track.base, rule: `${SEMANTIC}${ask.id}`, subject, level: "info",
        message: `${ask.id} for ${subject}, following ${q.id} = ${from.answer}.`,
      };
      delete base.judgment; delete base.provenance;
      const track = newTrack(ctx, base, subject, pathOf(item.track), item.track);
      // Pairs are worded by the node they were drawn under: the set for member pairs, the root for section pairs.
      const it = makeItem(ctx, track, ask, subject, text, from, over, round, slice, over === "members" ? undefined : item.kind);
      track.entry = it;
      const existing = ctx.seen.get(it.key);
      if (existing) {
        ctx.tracks.pop();
        item.track.children.pop();
        if (!existing.parents.includes(item.track)) { existing.parents.push(item.track); item.track.children.push(existing); }
        return;
      }
      ctx.seen.set(it.key, track);
      out.push(it);
    };
    if (over === "members") {
      for (const m of memberIds(ctx, step.state, item.subject)) spawn(m, nodeText(ctx.byId.get(m)));
    } else if (over === "pairs") {
      const members = memberIds(ctx, step.state, item.subject);
      const picked = !fallback && d.answer !== undefined && members.includes(d.answer) ? d.answer : undefined;
      const pairs: [string, string][] = picked ? members.filter((m) => m !== picked).map((m) => [picked, m])
        : members.flatMap((a, i) => members.slice(i + 1).map((b) => [a, b] as [string, string]));
      for (const [a, b] of rankPairs(ctx, pairs, ctx.limits.maxPairsPerSet)) spawn(pairSubject(a, b), "");
    } else if (fallback) {
      // The section walk failed: pair statements across sections, anchored on a section that was picked if any.
      const sections = sectionsOf(ctx, item.track.subject);
      const picked = item.track.steps.filter((x) => x.decision.status !== "unknown" && x.decision.answer !== undefined && sections.includes(x.decision.answer))
        .map((x) => x.decision.answer!);
      const anchor = picked[0];
      const pairs: [string, string][] = [];
      for (const [i, a] of sections.entries()) {
        for (const b of sections.slice(i + 1)) {
          if (anchor !== undefined && a !== anchor && b !== anchor) continue;
          for (const x of unitsOf(ctx, a)) for (const y of unitsOf(ctx, b)) pairs.push([x, y]);
        }
      }
      for (const [a, b] of rankPairs(ctx, pairs, ctx.limits.maxCrossPairs)) spawn(pairSubject(a, b), "");
    } else {
      const picked = pickedChildren(ctx, item.track).slice(-2);
      if (picked.length < 2) return;
      const [s1, s2] = picked as [string, string];
      // Sections are compared through their members, whatever the follow-up's own slice says.
      if (over === "sections") { spawn(pairSubject(s1, s2), "", { ...ask.slice, children: true }); return; }
      const pairs = unitsOf(ctx, s1).flatMap((a) => unitsOf(ctx, s2).map((b) => [a, b] as [string, string]));
      for (const [a, b] of rankPairs(ctx, pairs, ctx.limits.maxCrossPairs)) spawn(pairSubject(a, b), "");
    }
  };

  let navFired = false;
  for (const [q, d, n] of entries) {
    if (!fires(q, d, n)) continue;
    if (q === item.question) navFired = true;
    follow(q, d, n);
  }

  // A navigation pick (a `choicesFrom` question) that came back unknown, unreadable or `none` does not end the walk:
  // the pairs it would have narrowed are taken from the pre-filters instead, capped as usual.
  const nav = item.question;
  if (nav.choicesFrom && !navFired) {
    const target = pairTargetOf(nav, ctx.catalogue);
    if (target) follow(nav, step.decision, { ask: target.id, over: nav.choicesFrom === "members" ? "pairs" : "crossPairs" }, true);
  }
  return out;
}

/** The pair question a navigation question leads to: the first `next` (through `self` steps) that walks pairs or sections. */
function pairTargetOf(q: Question, catalogue: Map<string, Question>): Question | undefined {
  const seen = new Set<string>();
  for (const queue = [q]; queue.length;) {
    const x = queue.shift()!;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    for (const n of x.next ?? []) {
      const y = catalogue.get(n.ask);
      if (!y) continue;
      if (n.over === "pairs" || n.over === "sections" || n.over === "crossPairs") return y;
      queue.push(y);
    }
  }
  return undefined;
}

/** The statements a section stands for in cross pairs: its texted descendants, or the section itself when it has none. */
function unitsOf(ctx: FunnelContext, section: string): string[] {
  const below = descendants(ctx, section).filter((n) => texted(ctx, n)).map((n) => n.id);
  return below.length ? below : [section];
}

/**
 * Items the budget cut before they were asked: a finding not yet asked anything becomes `unknown` with provider
 * `budget`; one cut mid-walk keeps its earlier step and is marked `provenance.truncated`.
 */
export function budgetLeftovers(items: Item[], ctx: FunnelContext): void {
  if (items.length) ctx.exhausted = true;
  for (const it of items) {
    if (!it.track.steps.length) it.track.budget = true;
    else it.track.truncated = true;
  }
}

const BAD: Level[] = ["error", "warning"];

/** The step that describes a finding: the deepest confident, non-navigation step that does not pass; else the first. */
const pickStep = (t: Track): Step | undefined =>
  [...t.steps].reverse().find((s) => s.decision.status === "confident" && !s.nav && s.decision.level !== "pass") ?? t.steps[0];

/** A track's finding before parents are reconciled. */
/** The check id of a `check:<owner>.<id>` rule. */
export const checkIdOf = (rule: string): string | undefined =>
  rule.startsWith(CHECK_PREFIX) && rule.includes(".") ? rule.slice(rule.indexOf(".") + 1) : undefined;
const checkOf = (rule: string) => { const c = checkIdOf(rule); return c === undefined ? {} : { check: c }; };

export function settle(t: Track, ctx: FunnelContext): Finding {
  const s = pickStep(t);
  if (!s) {
    const q = t.entry.question;
    return {
      ...t.base, level: "info", judgment: { question: q.id, status: "unknown", ...checkOf(q.id) },
      provenance: {
        provider: "budget", model: ctx.s1.model, stateHash: hashOf(t.entry.state), questionHash: hashOf(q), thresholds: ctx.t,
        error: { name: "Budget", code: "budget", message: "the judge's call or round budget ran out before this was asked" },
        round: t.entry.round, stage: t.entry.stage,
      },
    };
  }
  const d = s.decision;
  return {
    ...t.base, level: d.level,
    judgment: {
      question: s.question.id, status: d.status,
      ...(d.answer !== undefined && { answer: d.answer, confidence: d.confidence }),
      ...(d.probabilities && { probabilities: d.probabilities }),
      ...(d.defect !== undefined && { defect: d.defect }),
      ...(s.banded !== undefined && { bandedConfidence: s.banded }),
      ...checkOf(t.entry.question.id),
      path: pathOf(t),
    },
    provenance: { ...s.provenance, ...(t.truncated && { truncated: true }) },
  };
}

/** Duplicate candidates take their twin's steps, prefix and follow-ups, so both settle (and reconcile) alike. */
export function resolveMirrors(tracks: Track[]): void {
  for (const t of tracks) {
    let m = t.mirror;
    const seen = new Set<Track>([t]);
    while (m?.mirror && !seen.has(m.mirror)) { seen.add(m); m = m.mirror; }
    if (!m || t.steps.length) continue;
    t.steps = m.steps;
    t.children = m.children;
    if (m.truncated) t.truncated = true;
    if (m.budget) t.budget = true;
  }
}

const leafId = (f: Finding) => `${f.judgment?.defect ?? f.rule.slice(SEMANTIC.length)}@${f.subject ?? ""}`;

/**
 * Parents after their follow-up findings: a parent with a descendant that confirmed a defect (confident at error or
 * warning) drops to `info` with `judgment.narrowedBy`; a flagged parent whose follow-ups all passed confidently goes
 * to `review`; otherwise (a follow-up unknown, in review or cut) the parent keeps its level. Children are reconciled
 * before their parents by a depth-first walk, whatever order the tracks were created in.
 */
export function reconcileParents(tracks: Track[], findings: Map<Track, Finding>): void {
  const leaves = new Map<Track, Track[]>();
  const visiting = new Set<Track>();
  // Depth first over children, memoised: a child linked to a parent created after it is still settled first.
  const visit = (t: Track): Track[] => {
    const known = leaves.get(t);
    if (known) return known;
    if (visiting.has(t)) return [];
    visiting.add(t);
    const below = [...new Set(t.children.flatMap(visit))];
    visiting.delete(t);
    const f = findings.get(t);
    if (!f) { leaves.set(t, below); return below; }
    const own = f.judgment?.status === "confident" && BAD.includes(f.level) ? [t] : [];
    const out = below.length ? below : own;
    leaves.set(t, out);
    if (!t.children.length) return out;
    if (below.length) {
      findings.set(t, { ...f, level: "info", judgment: { ...f.judgment!, narrowedBy: [...new Set(below.map((c) => leafId(findings.get(c)!)))].sort() } });
    } else if (BAD.includes(f.level) && t.children.every((c) => { const cf = findings.get(c); return cf?.judgment?.status === "confident" && cf.level === "pass"; })) {
      findings.set(t, { ...f, level: "review" });
    }
    return out;
  };
  for (const t of tracks) visit(t);
}
