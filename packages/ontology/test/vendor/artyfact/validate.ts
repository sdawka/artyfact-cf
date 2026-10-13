import { explain, parse, render, run, type DerivationTree, type Tuple } from "@artyfact/rules";
import { toFacts } from "./facts.ts";
import type { SystemModel } from "./load.ts";
import { sha256Hex as sha256 } from "@artyfact/rules";

export interface RulePack { id: string; version: string; source: string }

export interface Finding {
  level: "error" | "missing" | "warning" | "info";
  /** Rule id from the pack; `semantic:<rule>` for semantic candidates. */
  rule: string;
  subject?: string;
  message: string;
  /** EDB facts at the leaves of the derivation, each as `[relation, ...tuple]`. */
  facts: Tuple[];
  derivation: DerivationTree;
  /** `<pack id>@<version>` whose rule derived the finding, when known. */
  pack?: string;
}

export interface Readiness {
  snapshotHash: string;
  packs: { id: string; version: string; hash: string }[];
  findings: Finding[];
  derived: Record<string, Tuple[]>;
  incomplete: boolean;
  actionable: boolean;
}

const LEVEL_ORDER: Finding["level"][] = ["error", "missing", "warning", "info"];

function leaves(t: DerivationTree, out: Tuple[] = []): Tuple[] {
  if (t.edb) out.push([t.relation, ...t.tuple]);
  for (const c of t.children) leaves(c, out);
  return out;
}

/** validate = toFacts → rules.run(packs) → fold violation/missing/warning/semanticCandidate into Findings. */
export function validate(m: SystemModel, packs: RulePack[]): Readiness {
  const facts = toFacts(m);
  const packNames = packs.map((p) => `${p.id}@${p.version}`);
  const programs = packs.map((p, i) => parse(p.source, packNames[i]));
  const result = run(facts, programs);

  const findings: Finding[] = [];
  const fold = (relation: string, level: (t: Tuple) => Finding["level"], prefix = "") => {
    for (const t of result.relations.get(relation) ?? []) {
      const rule = String(t[0]);
      const derivation = explain(result, relation, t);
      const origin = derivation.rule?.slice(0, derivation.rule.lastIndexOf(":"));
      findings.push({
        level: level(t),
        rule: prefix + rule,
        ...(t[1] !== undefined && { subject: String(t[1]) }),
        message: result.messages.has(rule) ? render(result.messages, t) : rule,
        facts: leaves(derivation),
        derivation,
        ...(origin && packNames.includes(origin) && { pack: origin }),
      });
    }
  };
  fold("violation", (t) => (t[2] === "hard" ? "error" : "warning"));
  fold("missing", () => "missing");
  fold("warning", () => "warning");
  fold("semanticCandidate", () => "info", "semantic:");
  findings.sort((a, b) =>
    LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.rule.localeCompare(b.rule) || (a.subject ?? "").localeCompare(b.subject ?? ""));

  const derived = Object.fromEntries([...result.relations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const hasError = findings.some((f) => f.level === "error");
  return {
    snapshotHash: facts.hash,
    packs: packs.map((p) => ({ id: p.id, version: p.version, hash: sha256(p.source) })),
    findings,
    derived,
    incomplete: result.incomplete,
    actionable: !hasError && !result.incomplete,
  };
}
