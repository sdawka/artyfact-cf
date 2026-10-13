import { RuleParseError, StratificationError, type Decl, type Program, type Rule, type Stratum } from "./types.ts";

/** Merge declarations across programs; the same relation must have the same arity and column types everywhere. */
export function mergeDecls(programs: Program[]): Map<string, Decl> {
  const all = new Map<string, Decl>();
  for (const p of programs) {
    for (const d of p.decls.values()) {
      const prev = all.get(d.name);
      if (!prev) { all.set(d.name, { ...d }); continue; }
      const sig = (x: Decl) => x.columns.map((c) => c.type).join(",");
      if (sig(prev) !== sig(d)) {
        throw new RuleParseError(p.name, d.line, 1, `relation '${d.name}' declared as (${sig(d)}) but elsewhere as (${sig(prev)})`);
      }
      prev.output ||= d.output;
    }
  }
  return all;
}

/** Group rules into strata (SCCs of the predicate dependency graph), dependencies first. */
export function stratify(programs: Program[]): Stratum[] {
  mergeDecls(programs);
  const rules = programs.flatMap((p) => p.rules);
  const byHead = new Map<string, Rule[]>();
  const edges = new Map<string, Map<string, boolean>>(); // head -> body relation -> negative?
  const nodes = new Set<string>();
  for (const r of rules) {
    const h = r.head.rel;
    nodes.add(h);
    byHead.set(h, [...(byHead.get(h) ?? []), r]);
    const out = edges.get(h) ?? new Map<string, boolean>();
    edges.set(h, out);
    for (const l of r.body) {
      const dep = l.kind === "atom" ? { rel: l.rel, neg: l.negated } : l.kind === "count" ? { rel: l.atom.rel, neg: true } : null;
      if (!dep) continue;
      nodes.add(dep.rel);
      out.set(dep.rel, (out.get(dep.rel) ?? false) || dep.neg);
    }
  }
  const succ = (n: string) => [...(edges.get(n)?.keys() ?? [])].sort();

  // Tarjan's SCC; emits sink components first, i.e. dependencies before dependents.
  const index = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>();
  const stack: string[] = [], sccs: string[][] = [];
  let counter = 0;
  const visit = (v: string) => {
    index.set(v, counter); low.set(v, counter); counter++;
    stack.push(v); onStack.add(v);
    for (const w of succ(v)) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); scc.push(w); } while (w !== v);
      sccs.push(scc.sort());
    }
  };
  for (const n of [...nodes].sort()) if (!index.has(n)) visit(n);

  const strata: Stratum[] = [];
  for (const scc of sccs) {
    const members = new Set(scc);
    for (const h of scc) {
      for (const [b, neg] of edges.get(h) ?? []) {
        if (neg && members.has(b)) {
          const cycle = [h, ...pathWithin(b, h, members, succ)];
          throw new StratificationError(cycle, `negation or count through recursive cycle: ${cycle.join(" -> ")}`);
        }
      }
    }
    const sccRules = scc.flatMap((h) => byHead.get(h) ?? []);
    if (sccRules.length) strata.push({ relations: scc, rules: sccRules });
  }
  return strata;
}

function pathWithin(from: string, to: string, members: Set<string>, succ: (n: string) => string[]): string[] {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) break;
    for (const s of succ(n)) if (members.has(s) && !prev.has(s)) { prev.set(s, n); queue.push(s); }
  }
  const path: string[] = [];
  for (let n: string | null | undefined = to; n != null; n = prev.get(n)) path.unshift(n);
  return path;
}
