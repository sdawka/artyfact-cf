/**
 * `model-rules` engine (C.system.structure and friends): Genome files → `loadGenome` → `validate` (the engine's packs and
 * the pinned template packs; a pin no template declares is a `rulePack.unavailable` error, as on readiness).
 * fail on any `error` finding (or an unparsable Genome); unknown if the rules run was incomplete;
 * pass otherwise. Observations carry every finding with its derivation, the readiness summary, errors introduced
 * vs base, and the SemanticDelta vs base.
 */
import {
  diffModels, LegacyGenomeError, loadGenome as loadModel, ModelParseError, rulePacksOf, validate,
  type Finding, type Readiness, type RulePack, type SemanticDelta, type SystemModel, type TemplateStore,
} from "@artyfact/model";
import { NODE_FILE, V1_ROOT_FILE } from "@artyfact/ontology/genome";
import { metaTemplates } from "@artyfact/templates";
import type { FileMap } from "./contract";
import { errored, errorMessage, type Outcome } from "./provenance";

const GENOME_PREFIX = "system/";

/**
 * Genome-relative file map: files under `system/` when the map has `system/node.yaml` (or a v1 `system/system.yaml`,
 * so a legacy Genome is recognised as one, as `genomePrefix` does), else the map as is.
 */
export function genomeRoot(files: FileMap): Map<string, string> {
  const entries = Object.entries(files);
  const atRoot = NODE_FILE in files || V1_ROOT_FILE in files;
  if (!atRoot && (`${GENOME_PREFIX}${NODE_FILE}` in files || `${GENOME_PREFIX}${V1_ROOT_FILE}` in files)) {
    return new Map(entries.filter(([p]) => p.startsWith(GENOME_PREFIX)).map(([p, t]) => [p.slice(GENOME_PREFIX.length), t]));
  }
  return new Map(entries);
}

export interface GenomeDeps {
  /** meta@1 template sources by ref; the bundled templates by default. */
  templates?: TemplateStore;
  /** Readiness of a loaded model; `validate` by default (tests replace it to make the rules run fail). */
  validate?: (model: SystemModel) => Readiness;
}

/** Throws ModelParseError on an invalid Genome, LegacyGenomeError on a v1 one. */
export function loadGenome(files: FileMap, revision: string, deps: GenomeDeps = {}): SystemModel {
  return loadModel(genomeRoot(files), { revision, templates: deps.templates ?? metaTemplates });
}

export interface RulesFilter {
  /** Packs whose findings count: `id` (any version) or `id@version`. */
  packs?: string[];
  /** Only findings whose rule starts with this prefix count. */
  rulePrefix?: string;
}

/** Parse `hook.inputs` (`packs: "metamodel@1,readiness"`, `rulePrefix: "topology."`). */
export function filterFromInputs(inputs: Record<string, string>): RulesFilter | undefined {
  const packs = inputs.packs?.split(",").map((s) => s.trim()).filter(Boolean);
  const rulePrefix = inputs.rulePrefix?.trim();
  if (!packs?.length && !rulePrefix) return undefined;
  return { ...(packs?.length && { packs }), ...(rulePrefix && { rulePrefix }) };
}

const keep = (f: Finding, filter?: RulesFilter) =>
  (!filter?.packs || (f.pack !== undefined && (filter.packs.includes(f.pack) || filter.packs.includes(f.pack.slice(0, f.pack.lastIndexOf("@")))))) &&
  (!filter?.rulePrefix || f.rule.startsWith(filter.rulePrefix));

const key = (f: Finding) => `${f.rule} ${f.subject ?? ""}`.trim();

export interface ModelRulesInput {
  files: FileMap;
  revision: string;
  /** Canonical model at the base, for the delta and "introduced" errors. */
  base?: SystemModel;
  filter?: RulesFilter;
  deps?: GenomeDeps;
}

export interface ModelRulesResult {
  outcome: Outcome;
  /** The packs that ran (with sources), when the rules run started. */
  packs?: RulePack[];
  model?: SystemModel;
  readiness?: Readiness;
  delta?: SemanticDelta;
}

export function runRules(model: SystemModel, deps: GenomeDeps = {}): Readiness {
  return (deps.validate ?? validate)(model);
}

const RULE_HEAD = /^\s*(violation|missing|warning|semanticCandidate)\("([^"]+)"/gm;

/** Rule ids (as Findings name them) that `filter` can select from `packs`. */
export function selectableRules(packs: RulePack[], filter: RulesFilter): string[] {
  const out = new Set<string>();
  for (const p of packs) {
    const name = `${p.id}@${p.version}`;
    if (filter.packs && !filter.packs.includes(name) && !filter.packs.includes(p.id)) continue;
    for (const m of p.source.matchAll(RULE_HEAD)) {
      const rule = m[1] === "semanticCandidate" ? `semantic:${m[2]}` : m[2];
      if (!filter.rulePrefix || rule.startsWith(filter.rulePrefix)) out.add(rule);
    }
  }
  return [...out].sort();
}

/** A Genome in the retired v1 layout is not judged: unknown, with the reason `legacy-genome` (docs/design/ontology.md §2a). */
export function legacyOutcome(e: LegacyGenomeError): Outcome {
  return {
    execution: "completed",
    verdict: "unknown",
    observations: [{ kind: "legacy-genome", reason: e.code, message: e.message }],
    interpretation: `The Genome is in the retired v1 layout (${e.code}); it was not checked.`,
    limitations: [e.message],
  };
}

export function modelRules(input: ModelRulesInput): ModelRulesResult {
  let model: SystemModel;
  try {
    model = loadGenome(input.files, input.revision, input.deps);
  } catch (e) {
    if (e instanceof LegacyGenomeError) return { outcome: legacyOutcome(e) };
    if (e instanceof ModelParseError) {
      const { issues, file } = e;
      return {
        outcome: {
          execution: "completed",
          verdict: "fail",
          observations: [{ kind: "parse-error", file, issues: issues.map((i) => ({ path: i.path.map(String), message: i.message })) }],
          interpretation: `The Genome does not load: ${(e as Error).message}`,
          limitations: [],
        },
      };
    }
    return { outcome: errored(e, { interpretation: "Loading the Genome failed unexpectedly." }) };
  }

  let readiness: Readiness;
  let packs: RulePack[];
  try {
    packs = rulePacksOf(model);
    readiness = runRules(model, input.deps);
  } catch (e) {
    return { model, outcome: errored(e, { interpretation: "Running the pinned rule packs failed." }) };
  }

  let delta: SemanticDelta | undefined;
  const observations: unknown[] = [];
  const limitations: string[] = [];
  if (input.base) {
    try {
      delta = diffModels(input.base, model);
      observations.push({ kind: "semantic-delta", delta });
    } catch (e) {
      limitations.push(`Semantic delta vs base unavailable: ${errorMessage(e)}`);
    }
  }

  const findings = readiness.findings.filter((f) => keep(f, input.filter));
  const errors = findings.filter((f) => f.level === "error");
  observations.unshift(
    { kind: "readiness", snapshotHash: readiness.snapshotHash, packs: readiness.packs, incomplete: readiness.incomplete, actionable: readiness.actionable, ...(input.filter && { filter: input.filter }) },
    ...findings.map((f) => ({ level: f.level, rule: f.rule, subject: f.subject, message: f.message, pack: f.pack, facts: f.facts, derivation: f.derivation })),
  );

  if (input.base && errors.length) {
    try {
      const before = new Set(runRules(input.base, input.deps).findings.filter((f) => f.level === "error" && keep(f, input.filter)).map(key));
      observations.push({ kind: "introduced", errors: errors.map(key).filter((k) => !before.has(k)) });
    } catch (e) {
      limitations.push(`Could not compare with base findings: ${errorMessage(e)}`);
    }
  }

  const ran = readiness.packs.map((p) => `${p.id}@${p.version}`);
  const notPinned = (input.filter?.packs ?? []).filter((w) => !ran.includes(w) && !readiness.packs.some((p) => p.id === w));
  if (notPinned.length) observations.push({ kind: "packs-not-pinned", packs: notPinned, pinned: ran });

  // A filter that can select no rule at all checks nothing: never a pass (e.g. a mistyped rulePrefix).
  const selectable = input.filter !== undefined && readiness.packs.length > 0 && !notPinned.length ? selectableRules(packs, input.filter) : undefined;
  const selectsNothing = selectable !== undefined && selectable.length === 0;
  // semanticCandidate rules only produce info findings: a filter selecting only those can never fail.
  const selectsOnlyInfo = selectable !== undefined && selectable.length > 0 && selectable.every((r) => r.startsWith("semantic:"));
  if (selectsNothing) observations.push({ kind: "filter-selects-no-rules", filter: input.filter, droppedErrors: readiness.findings.filter((f) => f.level === "error").map(key) });
  if (selectsOnlyInfo) observations.push({ kind: "filter-selects-only-info-rules", filter: input.filter, rules: selectable });

  let verdict: Outcome["verdict"];
  let interpretation: string;
  if (errors.length) {
    verdict = "fail";
    interpretation = `${errors.length} hard violation(s): ${errors.map(key).join("; ")}.`;
  } else if (selectsNothing || selectsOnlyInfo) {
    verdict = "unknown";
    interpretation = selectsNothing
      ? `The hook's rule filter ${JSON.stringify(input.filter)} selects no rule in the pinned packs; nothing was checked.`
      : `The hook's rule filter ${JSON.stringify(input.filter)} selects only info-level rules, which cannot fail.`;
  } else if (notPinned.length) {
    verdict = "unknown";
    interpretation = `The hook asks for pack(s) ${notPinned.join(", ")}, which the System does not pin; they did not run.`;
  } else if (readiness.incomplete) {
    verdict = "unknown";
    interpretation = "The rules run hit its iteration cap; results are incomplete.";
  } else {
    verdict = "pass";
    interpretation = `No hard violations across ${readiness.packs.length} pack(s).`;
  }
  if (readiness.incomplete) limitations.push("Rules run incomplete (iteration cap).");
  return {
    model,
    readiness,
    packs,
    delta,
    outcome: { execution: "completed", verdict, observations, interpretation, limitations, provenance: { snapshotHash: readiness.snapshotHash, packs: readiness.packs.map((p) => `${p.id}@${p.version}:${p.hash.slice(0, 12)}`).join(",") } },
  };
}
