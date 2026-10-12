// Minimal stand-in for @artyfact/rules (branch w0-rules) until it merges: same exported API, naive
// stratified evaluation, just enough syntax for this package's tests. Delete when the real engine lands
// (also drop the `paths` entry in tsconfig.json and the vi.mock calls in tests).
import { sha256 } from "../../src/sha256";

export type Value = string | number | boolean;
export type Tuple = Value[];
export interface FactSet { relations: Map<string, Tuple[]>; hash: string }
type Term = { v: string } | { c: Value };
interface Atom { rel: string; args: Term[] }
type Lit = { pos: Atom } | { neg: Atom } | { cmp: "!="; a: Term; b: Term } | { builtin: "contains" | "matches"; a: Term; b: Term };
interface Rule { id: string; head: Atom; body: Lit[] }
export interface Program { name: string; decls: Map<string, { arity: number; output: boolean }>; rules: Rule[]; messages: Map<string, string> }
export interface Derivation { rule: string; head: Tuple; body: { relation: string; tuple: Tuple }[] }
export interface Result {
  relations: Map<string, Tuple[]>;
  derivations: Map<string, Derivation[]>;
  incomplete: boolean;
  stats: { iterations: number; derivedTuples: number; ms: number };
  messages: Map<string, string>;
}
export interface DerivationTree { relation: string; tuple: Tuple; rule?: string; edb: boolean; children: DerivationTree[]; truncated?: boolean; cycle?: boolean }

const key = (rel: string, t: Tuple) => rel + "\u0000" + JSON.stringify(t);
const cmpTuple = (a: Tuple, b: Tuple) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);

export function factSet(input: Record<string, Tuple[]> | Map<string, Tuple[]>): FactSet {
  const entries = input instanceof Map ? [...input] : Object.entries(input);
  const relations = new Map<string, Tuple[]>();
  for (const [rel, tuples] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!tuples.length) continue; // like the real engine: empty relations are omitted
    const uniq = new Map(tuples.map((t) => [JSON.stringify(t), t]));
    relations.set(rel, [...uniq.values()].sort(cmpTuple));
  }
  return { relations, hash: sha256(JSON.stringify([...relations])) };
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, q = false, cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function term(s: string): Term {
  if (s.startsWith('"')) return { c: s.slice(1, -1) };
  if (s === "true" || s === "false") return { c: s === "true" };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { c: Number(s) };
  return { v: s };
}
function atom(s: string): Atom {
  const m = /^(\w+)\((.*)\)$/s.exec(s.trim());
  if (!m) throw new Error(`stub rules: cannot parse atom ${s}`);
  return { rel: m[1], args: splitTop(m[2]).map(term) };
}

export function parse(src: string, name: string): Program {
  const p: Program = { name, decls: new Map(), rules: [], messages: new Map() };
  const lines = src.split("\n");
  let buf = "", startLine = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/%.*$/, "").trim();
    if (!line) return;
    let m;
    if ((m = /^\.decl\s+(\w+)\((.*)\)(\s+\.output)?$/.exec(line))) {
      p.decls.set(m[1], { arity: splitTop(m[2]).length, output: !!m[3] });
      return;
    }
    if ((m = /^\.message\s+"([^"]*)"\s+"(.*)"$/.exec(line))) { p.messages.set(m[1], m[2]); return; }
    if (!buf) startLine = i + 1;
    buf += " " + line;
    if (!buf.trimEnd().endsWith(".")) return;
    const text = buf.trim().slice(0, -1);
    buf = "";
    const [h, b] = text.split(":-");
    const body: Lit[] = b === undefined ? [] : splitTop(b).map((l): Lit => {
      if (l.startsWith("not ")) return { neg: atom(l.slice(4)) };
      const ne = /^(.+?)\s*!=\s*(.+)$/.exec(l);
      if (ne && !l.includes("(")) return { cmp: "!=", a: term(ne[1].trim()), b: term(ne[2].trim()) };
      const at = atom(l);
      if (at.rel === "contains" || at.rel === "matches") return { builtin: at.rel, a: at.args[0], b: at.args[1] };
      return { pos: at };
    });
    p.rules.push({ id: `${name}:${startLine}`, head: atom(h), body });
  });
  return p;
}

type Env = Map<string, Value>;
const val = (t: Term, env: Env): Value | undefined => ("c" in t ? t.c : env.get(t.v));
function unify(a: Atom, tuple: Tuple, env: Env): Env | null {
  const out = new Map(env);
  for (let i = 0; i < a.args.length; i++) {
    const t = a.args[i];
    if ("c" in t) { if (t.c !== tuple[i]) return null; continue; }
    if (t.v === "_") continue;
    const cur = out.get(t.v);
    if (cur === undefined) out.set(t.v, tuple[i]);
    else if (cur !== tuple[i]) return null;
  }
  return out;
}

export function run(facts: FactSet, programs: Program[], opts: { maxIterations?: number; all?: boolean } = {}): Result {
  const t0 = Date.now();
  const rules = programs.flatMap((p) => p.rules);
  const db = new Map<string, Map<string, Tuple>>();
  const rel = (r: string) => db.get(r) ?? db.set(r, new Map()).get(r)!;
  for (const [r, ts] of facts.relations) for (const t of ts) rel(r).set(JSON.stringify(t), t);
  // Stratify: head >= positive deps, head > negated deps.
  const s = new Map<string, number>();
  const get = (r: string) => s.get(r) ?? 0;
  for (let changed = true, guard = 0; changed && guard < 100; guard++) {
    changed = false;
    for (const r of rules) for (const l of r.body) {
      const need = "pos" in l ? get(l.pos.rel) : "neg" in l ? get(l.neg.rel) + 1 : 0;
      if (get(r.head.rel) < need) { s.set(r.head.rel, need); changed = true; }
    }
  }
  const derivations = new Map<string, Derivation[]>();
  const maxIt = opts.maxIterations ?? 10_000;
  let iterations = 0, derived = 0, incomplete = false;
  const strata = [...new Set(rules.map((r) => get(r.head.rel)))].sort((a, b) => a - b);
  for (const st of strata) {
    const rs = rules.filter((r) => get(r.head.rel) === st);
    for (let changed = true; changed;) {
      changed = false;
      if (++iterations > maxIt) { incomplete = true; break; }
      for (const r of rs) {
        let envs: { env: Env; body: { relation: string; tuple: Tuple }[] }[] = [{ env: new Map(), body: [] }];
        for (const l of r.body) {
          const next: typeof envs = [];
          for (const e of envs) {
            if ("pos" in l) {
              for (const t of rel(l.pos.rel).values()) {
                const u = unify(l.pos, t, e.env);
                if (u) next.push({ env: u, body: [...e.body, { relation: l.pos.rel, tuple: t }] });
              }
            } else if ("neg" in l) {
              if (![...rel(l.neg.rel).values()].some((t) => unify(l.neg, t, e.env))) next.push(e);
            } else if ("cmp" in l) {
              if (val(l.a, e.env) !== val(l.b, e.env)) next.push(e);
            } else {
              const a = String(val(l.a, e.env)), b = String(val(l.b, e.env));
              if (l.builtin === "contains" ? a.includes(b) : new RegExp(b).test(a)) next.push(e);
            }
          }
          envs = next;
        }
        for (const { env, body } of envs) {
          const head = r.head.args.map((t) => val(t, env)!) as Tuple;
          const k = JSON.stringify(head);
          const dk = key(r.head.rel, head);
          if (!rel(r.head.rel).has(k)) { rel(r.head.rel).set(k, head); changed = true; derived++; }
          const ds = derivations.get(dk) ?? [];
          if (ds.length < 8 && !ds.some((d) => d.rule === r.id && JSON.stringify(d.body) === JSON.stringify(body))) {
            ds.push({ rule: r.id, head, body });
            derivations.set(dk, ds);
          }
        }
      }
    }
  }
  const outputs = new Set(programs.flatMap((p) => [...p.decls].filter(([, d]) => opts.all || d.output).map(([n]) => n)));
  const relations = new Map<string, Tuple[]>();
  for (const r of [...outputs].sort()) relations.set(r, [...rel(r).values()].sort(cmpTuple));
  const messages = new Map(programs.flatMap((p) => [...p.messages]));
  return { relations, derivations, incomplete, stats: { iterations, derivedTuples: derived, ms: Date.now() - t0 }, messages };
}

export function explain(result: Result, relation: string, tuple: Tuple, depth = 6, seen = new Set<string>()): DerivationTree {
  const k = key(relation, tuple);
  const d = result.derivations.get(k)?.[0];
  if (!d) return { relation, tuple, edb: true, children: [] };
  if (depth <= 0 || seen.has(k)) return { relation, tuple, rule: d.rule, edb: false, children: [], truncated: true };
  const next = new Set(seen).add(k);
  return { relation, tuple, rule: d.rule, edb: false, children: d.body.map((b) => explain(result, b.relation, b.tuple, depth - 1, next)) };
}

export function render(messages: Map<string, string>, tuple: Tuple): string {
  const tpl = messages.get(String(tuple[0]));
  return tpl ? tpl.replace(/\{(\d+)\}/g, (_, n) => String(tuple[Number(n)] ?? "")) : String(tuple[0]);
}
