/**
 * `model-rules` engine (C.system.structure and friends): Genome files → `loadSystem` → `validate(packsFor(kits))`.
 * fail on any `error` finding (or an unparsable Genome); unknown if the rules run was incomplete or no pack ran;
 * pass otherwise. Observations carry every finding with its derivation, the readiness summary, errors introduced
 * vs base, and the SemanticDelta vs base.
 */
import { diffModels, loadSystem, ModelParseError, validate, type Finding, type Readiness, type SemanticDelta, type SystemModel, type TemplateStore } from "@artyfact/model";
import { packsFor as bundledPacksFor, templates as bundledTemplates, type RulePack } from "@artyfact/templates";
import type { FileMap } from "./contract";
import { errored, errorMessage, type Outcome } from "./provenance";

const GENOME_PREFIX = "system/";

/** Genome-relative file map: files under `system/` when the map has `system/system.yaml`, else the map as is. */
export function genomeRoot(files: FileMap): Map<string, string> {
  const entries = Object.entries(files);
  if (!("system.yaml" in files) && `${GENOME_PREFIX}system.yaml` in files) {
    return new Map(entries.filter(([p]) => p.startsWith(GENOME_PREFIX)).map(([p, t]) => [p.slice(GENOME_PREFIX.length), t]));
  }
  return new Map(entries);
}

export interface GenomeDeps {
  templates?: TemplateStore;
  packsFor?: (pins: { id: string; version: string }[]) => RulePack[];
}

/** Throws ModelParseError on an invalid Genome. */
export function loadGenome(files: FileMap, revision: string, deps: GenomeDeps = {}): SystemModel {
  // The templates package keeps a structural copy of the Template schema; it is the same shape at runtime.
  return loadSystem(genomeRoot(files), { revision, templates: deps.templates ?? (bundledTemplates as unknown as TemplateStore) });
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
  model?: SystemModel;
  readiness?: Readiness;
  delta?: SemanticDelta;
}

export function runRules(model: SystemModel, deps: GenomeDeps = {}): Readiness {
  const packs = (deps.packsFor ?? bundledPacksFor)(model.kits.rulePacks);
  return validate(model, packs);
}

export function modelRules(input: ModelRulesInput): ModelRulesResult {
  let model: SystemModel;
  try {
    model = loadGenome(input.files, input.revision, input.deps);
  } catch (e) {
    if (e instanceof ModelParseError) {
      return {
        outcome: {
          execution: "completed",
          verdict: "fail",
          observations: [{ kind: "parse-error", file: e.file, issues: e.issues.map((i) => ({ path: i.path.map(String), message: i.message })) }],
          interpretation: `The Genome does not load: ${e.message}`,
          limitations: [],
        },
      };
    }
    return { outcome: errored(e, { interpretation: "Loading the Genome failed unexpectedly." }) };
  }

  let readiness: Readiness;
  try {
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

  let verdict: Outcome["verdict"];
  let interpretation: string;
  if (readiness.packs.length === 0) {
    verdict = "unknown";
    interpretation = "No rule packs are pinned in kits.yaml; nothing was checked.";
  } else if (errors.length) {
    verdict = "fail";
    interpretation = `${errors.length} hard violation(s): ${errors.map(key).join("; ")}.`;
  } else if (notPinned.length) {
    verdict = "unknown";
    interpretation = `The hook asks for pack(s) ${notPinned.join(", ")}, which kits.yaml does not pin; they did not run.`;
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
    delta,
    outcome: { execution: "completed", verdict, observations, interpretation, limitations, provenance: { snapshotHash: readiness.snapshotHash, packs: readiness.packs.map((p) => `${p.id}@${p.version}:${p.hash.slice(0, 12)}`).join(",") } },
  };
}
