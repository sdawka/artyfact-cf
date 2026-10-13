// Runs rule packs against a fact set with the real @artyfact/rules engine.
import { factSet, parse, run, type Tuple } from "@artyfact/rules";
import { pack } from "./v1";

export type { Tuple };
export type Facts = Record<string, Tuple[]>;

export function parseSource(src: string, name: string) {
  return parse(src, name);
}

export interface Finding { relation: string; rule: string; subject: string }

export function evaluate(packIds: string[], facts: Facts) {
  const programs = packIds.map((id) => parse(pack(id).source, id));
  const result = run(factSet(facts), programs);
  const findings: Finding[] = [];
  for (const relation of ["violation", "missing", "warning", "semanticCandidate"]) {
    for (const t of result.relations.get(relation) ?? []) findings.push({ relation, rule: String(t[0]), subject: String(t[1]) });
  }
  return { result, findings, has: (rule: string, subject: string) => findings.some((f) => f.rule === rule && f.subject === subject) };
}

export function merge(...parts: Facts[]): Facts {
  const out: Facts = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) out[k] = [...(out[k] ?? []), ...v];
  return out;
}
