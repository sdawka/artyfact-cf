import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  artyfactGenome, kindGlossary, loadArtyfactSystem, loadTemplate, memoryStore, withSemanticProbes, PROBE_RULES_V2, type Graph,
  type Readiness, type SemanticProbeOptions, type Template,
} from "../../src/index.ts";
import { productGraphToGraph, productSpec } from "../../src/adapters/product/index.ts";
import { WORLD_KIND_CRITERIA, worldBase, worldSnapshotToGraph, worldTemplateSource } from "../../src/adapters/world/index.ts";
import { readDir } from "../../src/adapters/artyfact/node.ts";
import type { WorldSnapshot } from "../../src/adapters/world/contracts.ts";
import { templateFiles } from "../artyfact-reference.ts";

export const FIXTURES = join(__dirname, "../fixtures/semantic");

/**
 * A planted problem. `rule` is the question whose finding carries it;
 * `defect` is the defects@1 id expected, or alternatives, matched as a prefix of the finding's defect. `entry` names
 * the stage-1 finding the funnel reaches it through when that differs (a set or sections root, or the item a companion
 * question rides with); `alternatives` are
 * other subject sets that count, for routes that examine only one pair.
 */
export interface Planted {
  id: string;
  rule: string;
  subjects: string[];
  level: "warning" | "error";
  defect: string | string[];
  note: string;
  entry?: { rule: string; subject: string };
  alternatives?: string[][];
  /**
   * Set when `rule` is one of the template's checks (`check:<kind>.<id>`): only that rule's findings count for the
   * item. A deterministic check is a pattern, so its finding is not semantic and needs no provider call.
   */
  check?: { id: string; deterministic?: boolean };
}
export interface Control { id: string; subject: string; note: string }
/** `calls`: the provider-call envelope one live run of the fixture should stay within; the check questions take one call per subject they ask about. */
export interface Expectations { fixture: string; vocabulary: string; calls: number; planted: Planted[]; controls: Control[] }

export interface Vocabulary { name: string; template: Template; graph: Graph; expectations: Expectations }

const json = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));

/** v1 probe settings per vocabulary: which fields are statements, which kinds are measured, and how pairs are formed. */
export const SETTINGS_V1 = {
  artyfact: {
    version: "1",
    texts: ["description", "statement", "text", "claim", "summary", "outcome", "intent"],
    measurable: ["claim", "criterion"],
    criteria: ["criterion"],
    probePairs: ["governs"],
    siblings: ["component"],
    fields: ["name", "title", "description", "statement", "text", "claim", "summary", "outcome", "intent"],
  },
  product: {
    version: "1",
    texts: ["description"],
    measurable: ["outcome", "goal", "hypothesis"],
    criteria: ["rule", "test"],
    probePairs: [],
    siblings: ["purpose", "summary", "rule"],
    fields: ["title", "description"],
  },
  world: {
    version: "1",
    texts: ["description"],
    measurable: ["outcome", "indicator", "acceptanceCriterion"],
    criteria: ["acceptanceCriterion"],
    probePairs: ["authorizedBy"],
    siblings: [],
    fields: ["ws.title", "description"],
  },
} satisfies Record<string, SemanticProbeOptions>;

/**
 * v2 settings: the set kinds, sections, purpose kinds and pair relations. The per-kind wording (the glossary for
 * `node.kind` and `node.tangibility`, testability, set and pair criteria) comes from each template's kind `criteria`
 * (`ARTYFACT_CRITERIA`, `PRODUCT_CRITERIA`, `WORLD_KIND_CRITERIA`); a `kinds` entry here would override it per key.
 */
export const SETTINGS = {
  artyfact: {
    texts: SETTINGS_V1.artyfact.texts,
    fields: SETTINGS_V1.artyfact.fields,
    measurable: ["claim", "criterion"],
    criteria: ["criterion"],
    kinds: kindGlossary(artyfactGenome.kinds),
    sets: ["screen", "component", "policy"],
    probePairs: ["governs"],
  },
  product: {
    texts: ["description"],
    fields: ["title", "description"],
    measurable: ["outcome", "goal", "hypothesis"],
    criteria: ["rule", "test"],
    kinds: kindGlossary(productSpec.kinds),
    sets: ["*"],
    sections: true,
    purposeKinds: ["feature", "capability", "outcome"],
    probePairs: [],
  },
  world: {
    texts: ["description"],
    fields: ["ws.title", "description"],
    measurable: ["outcome", "indicator", "acceptanceCriterion"],
    criteria: ["acceptanceCriterion"],
    kinds: kindGlossary(Object.fromEntries(Object.entries(WORLD_KIND_CRITERIA).map(([k, criteria]) => [k, { criteria }]))),
    probePairs: ["authorizedBy"],
  },
} satisfies Record<string, SemanticProbeOptions>;

export type Version = "1" | "2";
const settingsOf = (name: keyof typeof SETTINGS, version: Version): SemanticProbeOptions => (version === "1" ? SETTINGS_V1 : SETTINGS)[name];

export function artyfactVocabulary(version: Version = "2"): Vocabulary {
  const template = loadTemplate(withSemanticProbes(artyfactGenome, settingsOf("artyfact", version)));
  const graph = loadArtyfactSystem(readDir(join(FIXTURES, "keep-in-touch-degraded")), { templates: templateFiles() }) as Graph;
  return { name: "artyfact", template, graph, expectations: json("keep-in-touch.expectations.json") };
}

export function productVocabulary(version: Version = "2"): Vocabulary {
  const template = loadTemplate(withSemanticProbes(productSpec, settingsOf("product", version)));
  const graph = productGraphToGraph(json("tidepool-degraded.graph.json"));
  return { name: "product", template, graph, expectations: json("tidepool.expectations.json") };
}

export function worldVocabulary(version: Version = "2"): Vocabulary {
  const snapshot = json("assistant-degraded.json") as WorldSnapshot;
  const template = loadTemplate(withSemanticProbes(worldTemplateSource(snapshot), settingsOf("world", version)), memoryStore([worldBase]));
  const graph = worldSnapshotToGraph(snapshot, template);
  return { name: "world", template, graph, expectations: json("assistant.expectations.json") };
}

export const VOCABULARIES = [artyfactVocabulary, productVocabulary, worldVocabulary];
/** The v1 vocabularies, kept for the v1 probe tests and the pinned OpenRouter wire test. */
export const VOCABULARIES_V1 = VOCABULARIES.map((make) => () => make("1"));

export const PROBE_RULES_V1 = ["text.vague", "text.unmeasurable", "pair.contradiction", "criterion.unfalsifiable"];
/** Rules either probe version emits candidates for. */
export const PROBE_RULES = [...new Set([...PROBE_RULES_V1, ...PROBE_RULES_V2])];
export const subjectOf = (p: Planted): string => [...p.subjects].sort().join("|");
/** Every subject string a planted item may be found on: its subjects, then its alternatives. */
export const subjectsOfPlanted = (p: Planted): string[] => [p.subjects, ...(p.alternatives ?? [])].map((s) => [...s].sort().join("|"));
/** Whether a finding's defect is (under) one of the planted defects. */
export const defectMatches = (found: string | undefined, planted: string | string[]): boolean =>
  found !== undefined && (Array.isArray(planted) ? planted : [planted]).some((d) => found === d || found.startsWith(`${d}.`));
/** Whether a finding's defect is on the planted defect's branch: one of its ancestors, the defect itself, or under it. */
export const defectRelated = (found: string | undefined, planted: string | string[]): boolean =>
  found !== undefined && (Array.isArray(planted) ? planted : [planted]).some((d) => defectMatches(found, d) || d.startsWith(`${found}.`));
export const probeFindings = (r: Readiness) => r.findings.filter((f) => PROBE_RULES.some((rule) => f.rule === `semantic:${rule}`));
/** Subjects a finding names: one node, or both ends of a pair. */
export const subjectsOf = (subject: string | undefined): string[] => (subject ?? "").split("|");
