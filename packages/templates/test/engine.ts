// Runs rule packs against a fact set. Uses the real `@artyfact/rules` engine once it exports one,
// otherwise the throwaway reference evaluator in test/stubs/rules.ts.
import * as real from "@artyfact/rules";
import * as stub from "./stubs/rules";
import { pack } from "../src/index";

export type Tuple = stub.Tuple;
export type Facts = Record<string, Tuple[]>;

const realEngine = real as unknown as {
  parse?: (src: string, name: string) => unknown;
  run?: (facts: unknown, programs: unknown[], opts?: unknown) => { relations: Map<string, Tuple[]>; messages: Map<string, string> };
  factSet?: (input: Facts) => unknown;
};
export const usingRealEngine = typeof realEngine.run === "function" && typeof realEngine.parse === "function" && typeof realEngine.factSet === "function";

export function parseSource(src: string, name: string): unknown {
  return usingRealEngine ? realEngine.parse!(src, name) : stub.parse(src, name);
}

export interface Finding { relation: string; rule: string; subject: string }

export function evaluate(packIds: string[], facts: Facts) {
  const programs = packIds.map((id) => parseSource(pack(id).source, id));
  const result = usingRealEngine
    ? realEngine.run!(realEngine.factSet!(facts), programs, { all: true })
    : stub.run(facts, programs as stub.StubProgram[]);
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

export function without(base: Facts, rel: string, pred: (t: Tuple) => boolean): Facts {
  return { ...base, [rel]: (base[rel] ?? []).filter((t) => !pred(t)) };
}
