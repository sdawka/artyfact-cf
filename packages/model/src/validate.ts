import { checksPack, CORE_PACKS, evaluate, packName, templateHash, type Template } from "@artyfact/ontology";
import type { DerivationTree, Tuple } from "@artyfact/rules";
import type { SystemModel } from "./genome.ts";
import { sha256 } from "./sha256.ts";

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
  /** `<pack id>@<version>` whose rule derived the finding, as the System pins it (`readiness@1`), when known. */
  pack?: string;
}

export interface Readiness {
  snapshotHash: string;
  packs: { id: string; version: string; hash: string }[];
  findings: Finding[];
  derived: Record<string, Tuple[]>;
  incomplete: boolean;
  /** No error finding and a complete run (`missing` findings do not block, as before the engine). */
  actionable: boolean;
}

const FINDING_HEAD = /^\s*(violation|missing|warning|semanticCandidate)\(/m;
/** The template namespace a pin may leave out: `readiness@1` pins `artyfact.readiness@1`. */
const NAMESPACE = "artyfact.";
const pinName = (id: string) => (id.startsWith(NAMESPACE) ? id.slice(NAMESPACE.length) : id);
type Pack = Template["rules"][number];
const pins = (p: Pack, pin: { id: string; version: string }) => (p.id === pin.id || p.id === `${NAMESPACE}${pin.id}`) && p.version === pin.version;

/**
 * The template rule packs that run for `m`, and the name each is reported under (its pin). A pinned `{id, version}`
 * selects the template pack `id`, or `artyfact.<id>`, at that version; a System that pins none runs every pack its
 * templates declare. A pack that derives no finding only feeds the others (`artyfact.facts`), so it always runs.
 * `unavailable` lists the pins no template declares.
 */
export function selectPacks(m: Pick<SystemModel, "template" | "kits">): { rules: Pack[]; labels: Map<string, string>; unavailable: string[] } {
  const pinned = m.kits.rulePacks;
  const rules = m.template.rules.filter((p) => !pinned.length || !FINDING_HEAD.test(p.source) || pinned.some((x) => pins(p, x)));
  const labels = new Map(rules.map((p) => [packName(p), `${pinName(p.id)}@${p.version}`]));
  const unavailable = pinned.filter((x) => !rules.some((p) => pins(p, x))).map((x) => `${x.id}@${x.version}`);
  return { rules, labels, unavailable };
}

/** Every pack readiness runs for `m`: the engine's core packs and kind checks, then the selected template packs, named as reported. */
export function rulePacksOf(m: Pick<SystemModel, "template" | "kits">): RulePack[] {
  const checks = checksPack(m.template);
  return [...CORE_PACKS, ...(checks ? [checks] : []), ...selectPacks(m).rules].map((p) => ({ id: pinName(p.id), version: p.version, source: p.source }));
}

const unavailableFinding = (pin: string, system: string): Finding => ({
  level: "warning", rule: "rulePack.unavailable", subject: pin,
  message: `${system} pins rule pack ${pin}, which none of its templates declares; it did not run.`,
  facts: [], derivation: { relation: "rulePack.unavailable", tuple: [pin], edb: true, children: [] },
});

const LEVEL_ORDER: Finding["level"][] = ["error", "missing", "warning", "info"];

/** Readiness: the engine's `evaluate` of the Genome graph under its composed template, running the selected packs. */
export function validate(m: SystemModel): Readiness {
  const { rules, labels, unavailable } = selectPacks(m);
  const t = { ...m.template, rules };
  const r = evaluate({ ...t, hash: templateHash(t) }, m.graph, { derived: true });
  const findings: Finding[] = [
    ...r.findings.map((f): Finding => ({
      level: f.level as Finding["level"], rule: f.rule, ...(f.subject !== undefined && { subject: f.subject }), message: f.message,
      facts: f.facts, derivation: f.derivation, ...(f.pack !== undefined && { pack: labels.get(f.pack) ?? f.pack }),
    })),
    ...unavailable.map((pin) => unavailableFinding(pin, m.system.id)),
  ].sort((a, b) =>
    LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.rule.localeCompare(b.rule) || (a.subject ?? "").localeCompare(b.subject ?? ""));
  return {
    snapshotHash: r.snapshotHash,
    packs: rulePacksOf(m).map((p) => ({ id: p.id, version: p.version, hash: sha256(p.source) })),
    findings,
    derived: r.derived ?? {},
    incomplete: r.incomplete,
    actionable: !r.incomplete && !findings.some((f) => f.level === "error"),
  };
}
