import { canon } from "../canon.ts";
import type { Graph } from "../graph/graph.ts";
import { maxOf, parseCardinality } from "../meta/cardinality.ts";
import type { Template } from "../meta/template.ts";
import { DEFECTS, mergeDefects } from "../judge/defects.ts";
import { factSet, type FactSet, type Tuple } from "@artyfact/rules";
import { checkFacts } from "./checks.ts";
import { compilePattern, isPlaceholder, kindTextConstraints, normaliseText, textLength, textWords } from "./text.ts";

export type Facts = Record<string, Tuple[]>;

const ACCEPTS: Tuple[] = [
  ["string", "string"], ["number", "number"], ["boolean", "boolean"], ["ref", "string"],
  ["refs", "list"], ["list", "list"], ["object", "object"],
];

const encode = (v: unknown): string | undefined =>
  v === null || v === undefined || v === "" ? undefined
    : typeof v === "string" ? v
    : typeof v === "number" || typeof v === "boolean" ? String(v)
    : canon(v);

const observed = (v: unknown): string =>
  Array.isArray(v) ? "list" : v !== null && typeof v === "object" ? "object" : typeof v;

class Emitter {
  out: Facts = {};
  push(rel: string, ...t: Tuple): void { (this.out[rel] ??= []).push(t); }
}

export function templateFacts(t: Template): Facts {
  const f = new Emitter();
  f.push("templateRef", t.ref);
  for (const [a, b] of ACCEPTS) f.push("typeAccepts", a, b);
  for (const [k, kind] of Object.entries(t.kinds)) {
    f.push("kind", k);
    for (const fd of kind.fields) {
      f.push("kindField", k, fd.name, fd.type, fd.required ?? false);
      if (fd.required) f.push("requiredField", k, fd.name);
      for (const v of fd.enum ?? []) f.push("kindFieldEnum", k, fd.name, String(v));
    }
    for (const [fd, c] of kindTextConstraints(kind, t.textDefaults)) {
      if (c.minLength !== undefined) f.push("textMinLen", k, fd, c.minLength);
      if (c.minWords !== undefined) f.push("textMinWords", k, fd, c.minWords);
      for (const o of c.distinctFrom ?? []) f.push("textDistinct", k, fd, o);
      if (c.pattern !== undefined) f.push("textPattern", k, fd);
    }
    for (const p of kind.parents ?? []) f.push("kindParent", k, p);
    for (const fd of kind.completeness.fields) f.push("requiredField", k, fd);
    for (const c of kind.completeness.children) {
      const card = parseCardinality(c.cardinality);
      f.push("requiredChild", k, c.kind, card.min, maxOf(card));
    }
    for (const r of kind.completeness.relations) {
      const card = parseCardinality(r.cardinality);
      f.push("requiredRel", k, r.rel, card.min, maxOf(card));
    }
  }
  for (const [r, rel] of Object.entries(t.relations)) {
    f.push("relation", r);
    for (const k of rel.from) f.push("relEndpoint", r, "from", k);
    for (const k of rel.to) f.push("relEndpoint", r, "to", k);
    for (const dir of ["out", "in"] as const) {
      const card = parseCardinality(rel.cardinality[dir]);
      f.push("relCard", r, dir, card.min, maxOf(card));
    }
    if (rel.acyclic) f.push("relAcyclic", r);
    if (rel.inverse) f.push("relInverse", r, rel.inverse);
    if (rel.certainty) f.push("relCertainty", r, rel.certainty);
  }
  const c = t.constraints;
  for (const x of c.forbiddenCycles) for (const r of x.relations) f.push("forbiddenCycle", x.id, r);
  for (const x of c.incompatible) {
    for (const w of x.when) f.push("incompatible", x.id, x.kind, w.field, String(w.value));
    f.push("incompatibleSize", x.id, new Set(x.when.map((w) => w.field)).size);
  }
  for (const x of c.exclusive) for (const r of x.relations) f.push("exclusive", x.id, r);
  for (const x of c.exactlyOne) for (const m of x.of) f.push("exactlyOne", x.id, x.kind, "field" in m ? "field" : "rel", "field" in m ? m.field : m.rel);
  for (const x of c.complete) f.push("completeScope", x.id, x.kind);
  for (const cr of t.criteria) {
    f.push("criterion", cr.id, cr.owner, cr.subject, cr.severity);
    for (const g of cr.gates) f.push("criterionGate", cr.id, g);
    for (const h of cr.hooks) f.push("criterionHook", cr.id, h);
  }
  for (const d of mergeDefects(DEFECTS, t.defects).defects) f.push("defect", d.id, d.parent ?? "", d.scope, d.level);
  for (const q of t.questions) {
    f.push("question", q.id, q.answer);
    const defects = new Set([...(q.defect ? [q.defect] : []), ...q.policy.flatMap((p) => (p.defect ? [p.defect] : []))]);
    for (const d of [...defects].sort()) f.push("questionDefect", q.id, d);
    for (const a of new Set((q.next ?? []).map((n) => n.ask))) f.push("questionNext", q.id, a);
  }
  return f.out;
}

/** Per kind: the text constraints in force and the fields it requires. */
function textPlan(t: Template) {
  const plans = new Map<string, { text: ReturnType<typeof kindTextConstraints>; required: Set<string> }>();
  return (k: string) => {
    let p = plans.get(k);
    const kind = t.kinds[k];
    if (!p && kind) {
      const required = new Set([...kind.fields.filter((x) => x.required).map((x) => x.name), ...kind.completeness.fields]);
      plans.set(k, p = { text: kindTextConstraints(kind, t.textDefaults), required });
    }
    return p;
  };
}

/**
 * Text facts for one node. Only non-empty scalar strings are measured (an empty string is no field at all, so the
 * required-field rule owns it). Length and words are emitted for every constrained or required field; placeholder,
 * sameness and pattern facts only for constrained fields whose trimmed value is not blank.
 */
function textFacts(f: Emitter, n: Graph["nodes"][number], plan: ReturnType<ReturnType<typeof textPlan>>): void {
  if (!plan) return;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  for (const [name, raw] of Object.entries(n.fields)) {
    const v = str(raw);
    const c = plan.text.get(name);
    if (v === undefined || (!c && !plan.required.has(name))) continue;
    const len = textLength(v);
    f.push("fieldLen", n.id, name, len);
    f.push("fieldWords", n.id, name, textWords(v));
    if (!c || len === 0) continue;
    for (const tok of c.placeholders ?? []) if (isPlaceholder(v, tok)) f.push("fieldPlaceholder", n.id, name, tok);
    for (const o of c.distinctFrom ?? []) {
      const other = o === "id" ? n.id : str(n.fields[o]);
      if (other !== undefined && normaliseText(other) !== "" && normaliseText(other) === normaliseText(v)) f.push("fieldSameAs", n.id, name, o);
    }
    if (c.pattern !== undefined && compilePattern(c.pattern)?.test(v.trim()) === false) f.push("fieldPatternMiss", n.id, name);
  }
}

export function graphFacts(t: Template, g: Graph): Facts {
  const f = new Emitter();
  const plan = textPlan(t);
  f.push("graphTemplate", g.template);
  for (const n of g.nodes) {
    f.push("node", n.id, n.kind, n.parent ?? "");
    f.push("known", n.id);
    if (n.parent !== undefined) f.push("parent", n.id, n.parent);
    if (n.provisional) f.push("provisional", n.id);
    textFacts(f, n, plan(n.kind));
    const declared = new Map((t.kinds[n.kind]?.fields ?? []).map((d) => [d.name, d.type]));
    for (const [name, v] of Object.entries(n.fields)) {
      const values = (Array.isArray(v) ? v : [v]).map(encode).filter((x): x is string => x !== undefined);
      if (!values.length) continue;
      f.push("fieldType", n.id, name, observed(v));
      const isRef = declared.get(name) === "ref" || declared.get(name) === "refs";
      for (const x of values) {
        f.push("field", n.id, name, x);
        if (isRef) f.push("ref", n.id, name, x);
      }
    }
  }
  for (const l of g.links) {
    const certainty = l.certainty ?? t.relations[l.rel]?.certainty ?? "declared";
    f.push("link", l.from, l.rel, l.to, certainty);
    f.push("ref", l.from, l.rel, l.to);
  }
  for (const d of g.declarations) f.push("declared", d.scope, d.status);
  for (const e of g.evidence) {
    f.push("evidence", e.id, e.subject, e.kind);
    f.push("ref", e.id, "evidence", e.subject);
  }
  return { ...f.out, ...checkFacts(t, g) };
}

/** EDB for an instance evaluation: the graph set plus the template set. */
export const toFacts = (t: Template, g: Graph): FactSet => factSet({ ...templateFacts(t), ...graphFacts(t, g) });
