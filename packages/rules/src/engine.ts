import { sha256Hex } from "./sha256.ts";
import { mergeDecls, stratify } from "./stratify.ts";
import { keyOf, type Literal, type Program, type Rule, type Term, type Tuple, type Value } from "./types.ts";

export interface FactSet { relations: Map<string, Tuple[]>; hash: string }
export interface RunOptions { maxIterations?: number; all?: boolean }
export interface Derivation { rule: string; head: Tuple; body: { relation: string; tuple: Tuple }[] }
export interface Result {
  relations: Map<string, Tuple[]>;
  derivations: Map<string, Derivation[]>;
  incomplete: boolean;
  stats: { iterations: number; derivedTuples: number; ms: number };
  messages: Map<string, string>;
}

const MAX_DERIVATIONS = 8;
const tupleKey = (t: Tuple) => JSON.stringify(t);
export const derivationKey = (relation: string, t: Tuple) => relation + "\u0000" + tupleKey(t);

const typeRank = (v: Value) => (typeof v === "boolean" ? 0 : typeof v === "number" ? 1 : 2);
function compareValues(a: Value, b: Value): number {
  const r = typeRank(a) - typeRank(b);
  if (r) return r;
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareTuples(a: Tuple, b: Tuple): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareValues(a[i], b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}
const sortTuples = (ts: Tuple[]) => ts.sort(compareTuples);

export function factSet(input: Record<string, Tuple[]> | Map<string, Tuple[]>): FactSet {
  const entries = input instanceof Map ? [...input] : Object.entries(input);
  const relations = new Map<string, Tuple[]>();
  for (const [name, tuples] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const seen = new Map<string, Tuple>();
    for (const t of tuples) seen.set(tupleKey(t), [...t]);
    if (seen.size) relations.set(name, sortTuples([...seen.values()]));
  }
  return { relations, hash: sha256Hex(JSON.stringify([...relations])) };
}

/** A relation's tuples with set membership and a first-argument index. */
class Rel {
  tuples: Tuple[] = [];
  keys = new Set<string>();
  index = new Map<string, Tuple[]>();
  add(t: Tuple, k = tupleKey(t)): boolean {
    if (this.keys.has(k)) return false;
    this.keys.add(k);
    this.tuples.push(t);
    if (t.length) {
      const ik = keyOf(t[0]);
      const bucket = this.index.get(ik);
      if (bucket) bucket.push(t); else this.index.set(ik, [t]);
    }
    return true;
  }
  lookup(first: Value | undefined): Tuple[] {
    return first === undefined ? this.tuples : this.index.get(keyOf(first)) ?? [];
  }
}

// Compiled argument ops: match a constant, check a bound slot, bind a free slot, or ignore.
type ArgOp = { op: "const"; v: Value } | { op: "check"; s: number } | { op: "bind"; s: number } | { op: "skip" };
type Step =
  | { kind: "scan"; rel: string; args: ArgOp[]; pos: number }
  | { kind: "neg"; rel: string; args: ArgOp[] }
  | { kind: "count"; rel: string; args: ArgOp[]; result: ArgOp }
  | { kind: "filter"; test: (b: Value[]) => boolean }
  | { kind: "assign"; s: number; from: (b: Value[]) => Value };
interface Compiled { rule: Rule; steps: Step[]; head: (b: Value[]) => Tuple; scans: number }

const regexCache = new Map<string, RegExp>();
function regex(src: string): RegExp {
  let re = regexCache.get(src);
  if (!re) { re = new RegExp(src); regexCache.set(src, re); }
  return re;
}

function compile(rule: Rule): Compiled {
  const slots = new Map<string, number>();
  const bound = new Set<string>();
  const slot = (n: string) => slots.get(n) ?? (slots.set(n, slots.size), slots.size - 1);
  const argOp = (t: Term): ArgOp => {
    if (t.kind === "const") return { op: "const", v: t.value };
    if (t.kind === "wild") return { op: "skip" };
    if (bound.has(t.name)) return { op: "check", s: slot(t.name) };
    bound.add(t.name);
    return { op: "bind", s: slot(t.name) };
  };
  const getter = (t: Term): ((b: Value[]) => Value) => {
    if (t.kind === "const") { const v = t.value; return () => v; }
    const s = slot((t as { name: string }).name);
    return (b) => b[s];
  };
  const steps: Step[] = [];
  let scans = 0;
  for (const l of rule.body as Literal[]) {
    if (l.kind === "atom" && !l.negated) steps.push({ kind: "scan", rel: l.rel, args: l.args.map(argOp), pos: scans++ });
    else if (l.kind === "atom") steps.push({ kind: "neg", rel: l.rel, args: l.args.map(argOp) });
    else if (l.kind === "count") {
      const outer = new Set(bound);
      const args = l.atom.args.map(argOp);
      bound.clear(); outer.forEach((v) => bound.add(v)); // variables local to the aggregate stay unbound outside it
      steps.push({ kind: "count", rel: l.atom.rel, args, result: argOp({ kind: "var", name: l.result }) });
    } else if (l.kind === "builtin") {
      const [s, x] = l.args.map(getter);
      const neg = l.negated;
      const f = l.name === "contains"
        ? (b: Value[]) => { const a = s(b), c = x(b); return typeof a === "string" && typeof c === "string" && a.includes(c); }
        : (b: Value[]) => { const a = s(b), c = x(b); return typeof a === "string" && typeof c === "string" && regex(c).test(a); };
      steps.push({ kind: "filter", test: neg ? (b) => !f(b) : f });
    } else {
      const isFree = (t: Term) => t.kind === "var" && !bound.has(t.name);
      if (l.op === "=" && (isFree(l.left) || isFree(l.right))) {
        const [target, src] = isFree(l.left) ? [l.left, l.right] : [l.right, l.left];
        const from = getter(src);
        const s = slot((target as { name: string }).name);
        bound.add((target as { name: string }).name);
        steps.push({ kind: "assign", s, from });
      } else {
        const a = getter(l.left), c = getter(l.right);
        const sameType = (x: Value, y: Value) => typeof x === typeof y;
        const tests: Record<string, (x: Value, y: Value) => boolean> = {
          "=": (x, y) => x === y, "!=": (x, y) => x !== y,
          "<": (x, y) => sameType(x, y) && x < y, "<=": (x, y) => sameType(x, y) && x <= y,
          ">": (x, y) => sameType(x, y) && x > y, ">=": (x, y) => sameType(x, y) && x >= y,
        };
        const t = tests[l.op];
        steps.push({ kind: "filter", test: (b) => t(a(b), c(b)) });
      }
    }
  }
  const hs = rule.head.args.map(getter);
  return { rule, steps, head: (b) => hs.map((g) => g(b)), scans };
}

function matchArgs(t: Tuple, args: ArgOp[], b: Value[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.op === "const") { if (t[i] !== a.v) return false; }
    else if (a.op === "check") { if (t[i] !== b[a.s]) return false; }
    else if (a.op === "bind") b[a.s] = t[i];
  }
  return true;
}
function firstKey(args: ArgOp[], b: Value[]): Value | undefined {
  const a = args[0];
  return a?.op === "const" ? a.v : a?.op === "check" ? b[a.s] : undefined;
}

export function run(facts: FactSet, programs: Program[], opts: RunOptions = {}): Result {
  const t0 = Date.now();
  const maxIterations = opts.maxIterations ?? 10_000;
  const strata = stratify(programs);
  const decls = mergeDecls(programs);
  const store = new Map<string, Rel>();
  const rel = (n: string) => store.get(n) ?? (store.set(n, new Rel()), store.get(n)!);
  for (const name of decls.keys()) rel(name);
  for (const [name, tuples] of facts.relations) {
    const d = decls.get(name);
    if (!d) continue;
    const r = rel(name);
    for (const t of tuples) {
      if (t.length !== d.arity) throw new TypeError(`fact ${name}${JSON.stringify(t)}: arity ${t.length}, declared ${d.arity}`);
      r.add(t);
    }
  }

  const derivations = new Map<string, Derivation[]>();
  let iterations = 0, derivedTuples = 0, incomplete = false;

  outer: for (const stratum of strata) {
    const members = new Set(stratum.relations);
    const compiled = stratum.rules.map(compile);
    let delta = new Map<string, Rel>();

    const evalRule = (c: Compiled, deltaPos: number, next: Map<string, Rel>) => {
      const b: Value[] = [];
      const matched: { relation: string; tuple: Tuple }[] = [];
      const emit = () => {
        const head = c.head(b);
        const hk = tupleKey(head);
        const relName = c.rule.head.rel;
        const total = rel(relName);
        const pending = next.get(relName) ?? (next.set(relName, new Rel()), next.get(relName)!);
        const dk = relName + "\u0000" + hk;
        if (total.keys.has(hk) || pending.keys.has(hk)) {
          const ds = derivations.get(dk);
          // no entry means an EDB fact; otherwise keep one derivation per distinct rule, capped
          if (ds && ds.length < MAX_DERIVATIONS && !ds.some((d) => d.rule === c.rule.id)) {
            ds.push({ rule: c.rule.id, head, body: matched.map((m) => ({ ...m })) });
          }
          return;
        }
        pending.add(head, hk);
        derivations.set(dk, [{ rule: c.rule.id, head, body: matched.map((m) => ({ ...m })) }]);
      };
      const step = (i: number): void => {
        if (i === c.steps.length) { emit(); return; }
        const s = c.steps[i];
        if (s.kind === "scan") {
          const source = s.pos === deltaPos ? delta.get(s.rel) : rel(s.rel);
          if (!source) return;
          for (const t of source.lookup(firstKey(s.args, b))) {
            if (!matchArgs(t, s.args, b)) continue;
            matched[s.pos] = { relation: s.rel, tuple: t };
            step(i + 1);
          }
        } else if (s.kind === "neg") {
          // negated args are all bound or wildcards, so matching never writes to b
          if (!rel(s.rel).lookup(firstKey(s.args, b)).some((t) => matchArgs(t, s.args, b))) step(i + 1);
        } else if (s.kind === "count") {
          // aggregate-local variables bind slots no later step reads
          let n = 0;
          for (const t of rel(s.rel).lookup(firstKey(s.args, b))) if (matchArgs(t, s.args, b)) n++;
          if (s.result.op === "bind") { b[s.result.s] = n; step(i + 1); }
          else if (s.result.op === "check" && b[s.result.s] === n) step(i + 1);
        } else if (s.kind === "filter") {
          if (s.test(b)) step(i + 1);
        } else {
          b[s.s] = s.from(b);
          step(i + 1);
        }
      };
      step(0);
    };

    const recursivePositions = compiled.map((c) =>
      c.steps.flatMap((s) => (s.kind === "scan" && members.has(s.rel) ? [s.pos] : [])),
    );
    let first = true;
    for (;;) {
      if (iterations >= maxIterations) { incomplete = true; break outer; }
      iterations++;
      const next = new Map<string, Rel>();
      compiled.forEach((c, ci) => {
        if (first) evalRule(c, -1, next);
        else for (const p of recursivePositions[ci]) evalRule(c, p, next);
      });
      first = false;
      let added = 0;
      for (const [name, r] of next) for (const t of r.tuples) { rel(name).add(t); added++; }
      derivedTuples += added;
      delta = next;
      if (!added || recursivePositions.every((ps) => ps.length === 0)) break;
    }
  }

  const outputs = [...decls.values()].filter((d) => d.output).map((d) => d.name);
  const names = (opts.all ? [...store.keys()] : outputs).sort();
  const relations = new Map(names.map((n) => [n, sortTuples([...rel(n).tuples])] as [string, Tuple[]]));
  const messages = new Map<string, string>();
  for (const p of programs) for (const [k, v] of p.messages) if (!messages.has(k)) messages.set(k, v);
  return { relations, derivations, incomplete, stats: { iterations, derivedTuples, ms: Date.now() - t0 }, messages };
}

export function render(messages: Map<string, string>, tuple: Tuple): string {
  const id = String(tuple[0]);
  const tpl = messages.get(id);
  if (tpl === undefined) return `${id}: ${tuple.slice(1).join(", ")}`;
  return tpl.replace(/\{(\d+)\}/g, (m, n: string) => (Number(n) < tuple.length ? String(tuple[Number(n)]) : m));
}

