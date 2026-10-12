// TODO(w0-rules): throwaway reference evaluator for the .dl subset used by our packs
// (docs/design/rules.md D.1). Naive stratified bottom-up; no derivations. Delete once
// `@artyfact/rules` exports the real engine and test/engine.ts will pick that up automatically.
export type Value = string | number | boolean;
export type Tuple = Value[];

type Term = { v: string } | { c: Value } | { w: true };
interface Atom { rel: string; args: Term[] }
type Lit =
  | { t: "pos"; atom: Atom }
  | { t: "neg"; atom: Atom }
  | { t: "cmp"; op: string; l: Term; r: Term }
  | { t: "fn"; name: "contains" | "matches"; l: Term; r: Term }
  | { t: "count"; out: string; atom: Atom };
interface Rule { head: Atom; body: Lit[]; line: number }
export interface StubProgram { decls: Map<string, number>; messages: Map<string, string>; rules: Rule[] }

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, q = false, cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === sep) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function term(s: string): Term {
  s = s.trim();
  if (s === "_") return { w: true };
  if (s.startsWith('"')) return { c: s.slice(1, -1) };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { c: Number(s) };
  if (/^[A-Z]\w*$/.test(s)) return { v: s };
  throw new Error(`bad term ${s}`);
}

function atom(s: string): Atom {
  const m = /^(\w+)\((.*)\)$/s.exec(s.trim());
  if (!m) throw new Error(`bad atom ${s}`);
  return { rel: m[1], args: splitTop(m[2], ",").map(term) };
}

function literal(s: string): Lit {
  let m: RegExpExecArray | null;
  if ((m = /^not\s+(.*)$/s.exec(s))) return { t: "neg", atom: atom(m[1]) };
  if ((m = /^(\w+)\s*=\s*count\s*:\s*(.*)$/s.exec(s))) return { t: "count", out: m[1], atom: atom(m[2]) };
  if ((m = /^(contains|matches)\((.*)\)$/s.exec(s))) {
    const [l, r] = splitTop(m[2], ",");
    return { t: "fn", name: m[1] as "contains" | "matches", l: term(l), r: term(r) };
  }
  if ((m = /^(.+?)\s*(!=|<=|>=|=|<|>)\s*(.+)$/s.exec(s)) && !s.includes("(")) return { t: "cmp", op: m[2], l: term(m[1]), r: term(m[3]) };
  return { t: "pos", atom: atom(s) };
}

export function parse(src: string, name: string): StubProgram {
  const p: StubProgram = { decls: new Map(), messages: new Map(), rules: [] };
  src.split("\n").forEach((raw, i) => {
    const line = raw.replace(/%.*$/, "").trim();
    if (!line) return;
    const where = `${name}:${i + 1}`;
    let m: RegExpExecArray | null;
    if ((m = /^\.decl\s+(\w+)\((.*?)\)/.exec(line))) {
      p.decls.set(m[1], splitTop(m[2], ",").length);
    } else if ((m = /^\.message\s+"([^"]*)"\s+"(.*)"$/.exec(line))) {
      p.messages.set(m[1], m[2]);
    } else if (line.endsWith(".") && line.includes(":-")) {
      const [h, b] = line.slice(0, -1).split(":-");
      p.rules.push({ head: atom(h), body: splitTop(b, ",").map(literal), line: i + 1 });
    } else if (line.startsWith(".")) {
      throw new Error(`${where}: unsupported directive`);
    } else if (line.endsWith(".")) {
      throw new Error(`${where}: facts not supported`);
    } else {
      throw new Error(`${where}: cannot parse "${line}"`);
    }
  });
  for (const r of p.rules) {
    const atoms = [r.head, ...r.body.flatMap((l) => ("atom" in l ? [l.atom] : []))];
    for (const a of atoms) {
      const n = p.decls.get(a.rel);
      if (n === undefined) throw new Error(`${name}:${r.line}: undeclared relation ${a.rel}`);
      if (n !== a.args.length) throw new Error(`${name}:${r.line}: arity mismatch for ${a.rel}`);
    }
    // safety: head vars bound by a positive literal or count output
    const bound = new Set<string>();
    for (const l of r.body) {
      if (l.t === "pos") l.atom.args.forEach((a) => "v" in a && bound.add(a.v));
      if (l.t === "count") bound.add(l.out);
    }
    for (const a of r.head.args) if ("v" in a && !bound.has(a.v)) throw new Error(`${name}:${r.line}: unsafe head variable ${a.v}`);
  }
  return p;
}

type Env = Map<string, Value>;
const key = (t: Tuple) => JSON.stringify(t);

export interface StubResult { relations: Map<string, Tuple[]>; messages: Map<string, string> }

export function run(facts: Record<string, Tuple[]>, programs: StubProgram[]): StubResult {
  const rules = programs.flatMap((p) => p.rules);
  const rels = new Map<string, Map<string, Tuple>>();
  const rel = (n: string) => rels.get(n) ?? rels.set(n, new Map()).get(n)!;
  for (const [n, ts] of Object.entries(facts)) for (const t of ts) rel(n).set(key(t), t);

  // stratify: negation / count push the head one stratum above the body relation
  const stratum = new Map<string, number>();
  const s = (n: string) => stratum.get(n) ?? 0;
  for (let changed = true, guard = 0; changed; guard++) {
    if (guard > 1000) throw new Error("not stratifiable");
    changed = false;
    for (const r of rules) for (const l of r.body) {
      if (!("atom" in l)) continue;
      const need = s(l.atom.rel) + (l.t === "pos" ? 0 : 1);
      if (s(r.head.rel) < need) { stratum.set(r.head.rel, need); changed = true; }
    }
  }

  const val = (t: Term, env: Env): Value | undefined => ("c" in t ? t.c : "v" in t ? env.get(t.v) : undefined);
  const match = (a: Atom, tup: Tuple, env: Env): Env | undefined => {
    const e = new Map(env);
    for (let i = 0; i < a.args.length; i++) {
      const t = a.args[i];
      if ("w" in t) continue;
      const v = val(t, e);
      if (v === undefined) e.set((t as { v: string }).v, tup[i]);
      else if (v !== tup[i]) return undefined;
    }
    return e;
  };
  const solve = (body: Lit[], i: number, env: Env, emit: (e: Env) => void): void => {
    if (i === body.length) return emit(env);
    const l = body[i];
    switch (l.t) {
      case "pos":
        for (const tup of rel(l.atom.rel).values()) { const e = match(l.atom, tup, env); if (e) solve(body, i + 1, e, emit); }
        return;
      case "neg":
        for (const tup of rel(l.atom.rel).values()) if (match(l.atom, tup, env)) return;
        return solve(body, i + 1, env, emit);
      case "count": {
        let n = 0;
        for (const tup of rel(l.atom.rel).values()) if (match(l.atom, tup, env)) n++;
        if (n === 0) return;
        return solve(body, i + 1, new Map(env).set(l.out, n), emit);
      }
      case "fn": {
        const a = String(val(l.l, env)), b = String(val(l.r, env));
        const ok = l.name === "contains" ? a.includes(b) : new RegExp(b).test(a);
        return ok ? solve(body, i + 1, env, emit) : undefined;
      }
      case "cmp": {
        const a = val(l.l, env), b = val(l.r, env);
        if (l.op === "=" && a === undefined && "v" in l.l) return solve(body, i + 1, new Map(env).set(l.l.v, b!), emit);
        const ok = { "!=": a !== b, "=": a === b, "<": a! < b!, "<=": a! <= b!, ">": a! > b!, ">=": a! >= b! }[l.op];
        return ok ? solve(body, i + 1, env, emit) : undefined;
      }
    }
  };

  const max = Math.max(0, ...stratum.values());
  for (let st = 0; st <= max; st++) {
    const here = rules.filter((r) => s(r.head.rel) === st);
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of here) solve(r.body, 0, new Map(), (env) => {
        const tup = r.head.args.map((a) => val(a, env)!);
        const k = key(tup);
        if (!rel(r.head.rel).has(k)) { rel(r.head.rel).set(k, tup); changed = true; }
      });
    }
  }
  const out = new Map<string, Tuple[]>();
  for (const [n, m] of rels) out.set(n, [...m.values()]);
  return { relations: out, messages: new Map(programs.flatMap((p) => [...p.messages])) };
}
