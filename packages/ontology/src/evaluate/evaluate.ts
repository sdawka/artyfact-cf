import { graphHash, parseGraph, type Graph } from "../graph/graph.ts";
import { cachedForm, packName, TemplateFormError, type TemplateForm } from "../meta/form.ts";
import type { Template } from "../meta/template.ts";
import { sha256Hex } from "@artyfact/rules";
import { parse, run, type Result, type Tuple } from "@artyfact/rules";
import { checksPack } from "./checks.ts";
import { edbProgram } from "./edb.ts";
import { toFacts } from "./facts.ts";
import { compareFindings, fold, verdicts, type Finding } from "./findings.ts";
import { completeness, consistency, metamodel, text } from "./packs/index.ts";

export const CORE_PACKS = [metamodel, completeness, consistency, text];

export interface EvaluateOptions {
  maxIterations?: number;
  form?: TemplateForm;
  /** Also return every relation the runs derived (`Readiness.derived`). */
  derived?: boolean;
}

export interface Readiness {
  snapshotHash: string;
  template: { ref: string; hash: string; form: TemplateForm };
  packs: { id: string; version: string; hash: string }[];
  findings: Finding[];
  completeness: { required: number; satisfied: number; missing: string[] };
  consistency: { violations: number };
  /**
   * Judgment counts: findings by status, provider `calls`, funnel `rounds`, follow-up items `gated` by the pair, section
   * and term caps, whether the call or round `budget` ran out, and how many findings were `explained`.
   */
  judgments: {
    confident: number; review: number; unknown: number;
    calls: number; rounds: number; gated: number; budget: "ok" | "exhausted"; explained: number;
  };
  /** True when a run hit `maxIterations`; its findings are a lower bound. */
  incomplete: boolean;
  /** Relation -> tuples over every run, sorted by relation; only with `EvaluateOptions.derived`. */
  derived?: Record<string, Tuple[]>;
  buildable: boolean;
  actionable: boolean;
}

/** Every relation of the runs, sorted by name; a tuple several runs hold (the shared input facts) appears once. */
function derivedOf(results: Result[]): Record<string, Tuple[]> {
  const out = new Map<string, Map<string, Tuple>>();
  for (const r of results) {
    for (const [rel, tuples] of r.relations) {
      const m = out.get(rel) ?? new Map<string, Tuple>();
      for (const t of tuples) m.set(JSON.stringify(t), t);
      out.set(rel, m);
    }
  }
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, m]) => [rel, [...m.values()]]));
}

const pairKey = (t: readonly unknown[]) => JSON.stringify([t[0], t[1]]);

function runPacks(facts: ReturnType<typeof toFacts>, packs: Template["rules"], maxIterations?: number) {
  const names = packs.map(packName);
  const result = run(facts, [edbProgram(), ...packs.map((p, i) => parse(p.source, names[i]))], { maxIterations });
  return { result, names, findings: fold(result, names) };
}

/** Evaluates a graph against a form-valid template: core packs first, then the template's own packs. */
export function evaluate(template: Template, input: Graph | unknown, opts: EvaluateOptions = {}): Readiness {
  const form = opts.form ?? cachedForm(template);
  if (!form.valid) throw new TemplateFormError(template.hash, form.findings);
  const graph = parseGraph(input);
  const facts = toFacts(template, graph);
  const checks = checksPack(template);
  const core = checks ? [...CORE_PACKS, checks] : CORE_PACKS;
  const runs = [runPacks(facts, core, opts.maxIterations)];
  if (template.rules.length) runs.push(runPacks(facts, template.rules, opts.maxIterations));

  const findings = runs.flatMap((r) => r.findings).sort(compareFindings);
  const rows = (rel: string) => runs.flatMap((r: { result: Result }) => r.result.relations.get(rel) ?? []);
  const missing = new Set(rows("missing").map(pairKey));
  const required = new Set([...rows("obligation").map(pairKey), ...missing]);
  const incomplete = runs.some((r) => r.result.incomplete);

  return {
    snapshotHash: graphHash(graph),
    template: { ref: template.ref, hash: template.hash, form },
    packs: [...core, ...template.rules].map((p) => ({ id: p.id, version: p.version, hash: sha256Hex(p.source) })),
    findings,
    completeness: {
      required: required.size,
      satisfied: required.size - missing.size,
      missing: [...new Set(rows("missing").map((t) => String(t[1])))].sort(),
    },
    consistency: { violations: rows("violation").length },
    judgments: { confident: 0, review: 0, unknown: 0, calls: 0, rounds: 0, gated: 0, budget: "ok", explained: 0 },
    incomplete,
    ...(opts.derived && { derived: derivedOf(runs.map((r) => r.result)) }),
    ...verdicts(findings, incomplete),
  };
}
