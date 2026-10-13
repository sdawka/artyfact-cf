import type { WorldSnapshot } from "./contracts.ts";
import type { Field, Kind, KindCriteria, Relation, TemplateInput, TemplateNode } from "../../meta/schema.ts";
import { loadTemplate, memoryStore, type Template } from "../../meta/template.ts";
import { worldReadiness } from "./pack.ts";

/** Kinds, relations and node ids the adapter adds are prefixed so they cannot collide with World vocabulary. */
export const WS = "ws.";
export const WORLD_BASE_REF = "template.meta.world@1";
/** Rule id of the declared-complete scope constraint; equal to the Rust finding code it reproduces. */
export const SCOPE_RULE = "core.mandatory-scope-incomplete";

/** Mirrors `compiled_rule_pack_catalog()` in `crates/world-core/src/lib.rs`. */
export const COMPILED_RULE_PACKS = [
  { id: "core-foundation", version: "1", title: "Core model integrity", requiredFor: ["*"] },
  { id: "assistant-impact", version: "1", title: "Advisory personal assistant change impact", requiredFor: [] },
  { id: "assistant-foundation", version: "1", title: "Personal assistant foundation", requiredFor: ["assistant-world"] },
] as const;

/** Typed references world-core checks by kind: relation added by the adapter, source kind, expected target kind. */
export const TYPED_REFERENCES = [
  ["ws.purposeBeneficiary", "ws.purpose", "beneficiary"],
  ["ws.purposeOutcome", "ws.purpose", "outcome"],
  ["ws.environmentModel", "ws.environment", "environment"],
  ["ws.claimOutcome", "ws.claim", "outcome"],
  ["ws.claimIndicator", "ws.claim", "indicator"],
  ["ws.claimEvaluation", "ws.claim", "evaluationPlan"],
] as const;

export const nodeId = {
  snapshot: "ws:snapshot",
  purpose: "ws:purpose",
  environment: "ws:environment",
  active: "ws:activeConstraints",
  thing: (id: string) => `ws:thing:${id}`,
  thingTemplate: (id: string, version: string) => `ws:thingTemplate:${id}@${version}`,
  claim: (id: string) => `ws:claim:${id}`,
  scope: (id: string) => `ws:scope:${id}`,
  rulePack: (pin: string) => `ws:rulePack:${pin}`,
  requiredPack: (pin: string) => `ws:requiredPack:${pin}`,
  compiledPack: (pin: string) => `ws:compiledPack:${pin}`,
  requirement: (i: number) => `ws:requirement:${i}`,
  endpoint: (i: number) => `ws:endpoint:${i}`,
  duplicate: (collection: string, key: string) => `ws:duplicate:${collection}:${key}`,
};

export const pinOf = (p: { id: string; version: string }): string => `${p.id}@${p.version}`;

const str = (name: string, required?: boolean): Field => ({ name, type: "string", ...(required && { required }) });
const bool = (name: string): Field => ({ name, type: "boolean" });
const list = (name: string): Field => ({ name, type: "list" });
const kind = (fields: Field[], extra: Partial<Kind> = {}) => ({ fields, ...extra });
const CAPABILITIES = ["external", "forkable", "observable", "reversible"].map(bool);
const SOURCE = [str("sourceKind"), str("sourceRef")];

/** The fields every World object carries besides its properties. */
export const OBJECT_META_FIELDS = ["ws.title", "ws.sourceKind", "ws.sourceRef"];

/** The snapshot bookkeeping vocabulary, the compiled Rule Pack catalogue and `world.readiness@1`. */
export const worldBase: TemplateInput = {
  id: "template.meta.world",
  version: 1,
  meta: 1,
  kinds: {
    "ws.snapshot": kind([
      ...["worldId", "title", "revisionId", "templateId", "templateVersion", "templateRef", "phase", "stateKind"].map((n) => str(n)),
      list("activeConstraints"),
    ]),
    "ws.purpose": kind([str("statement")]),
    "ws.environment": kind([str("environmentId"), str("title")]),
    "ws.claim": kind([str("id"), str("title"), ...SOURCE]),
    "ws.thing": kind([
      ...["id", "thingKind", "title", "revisionId", "templateId", "templateVersion", "externalSystem", "connectionStatus"].map((n) => str(n)),
      ...CAPABILITIES, ...SOURCE,
    ]),
    "ws.thingTemplate": kind([str("id"), str("version"), str("title"), list("compatibleWorldTemplates"), bool("inheritsWorldContext"), ...CAPABILITIES]),
    "ws.scope": kind([str("scopeId")]),
    "ws.rulePack": kind([str("id"), str("version"), str("pin")]),
    "ws.requiredPack": kind([str("id"), str("version"), str("pin")]),
    "ws.compiledPack": kind([str("id"), str("version"), str("pin"), str("title"), list("requiredFor")]),
    "ws.requirement": kind(["ruleId", "subjectKind", "relationKind", "objectKind", "scopeId", "scope"].map((n) => str(n))),
    "ws.endpoint": kind([str("relationKind"), list("fromKinds"), list("toKinds")]),
    "ws.duplicate": kind([str("collection"), str("key"), { name: "count", type: "number" }]),
    /** Target kind of a typed reference whose expected kind the World Template does not declare. */
    "ws.unshaped": kind([]),
  },
  relations: {
    "ws.usesTemplate": { from: ["ws.thing"], to: ["ws.thingTemplate"] },
  },
  nodes: COMPILED_RULE_PACKS.map((p) => ({
    id: nodeId.compiledPack(pinOf(p)), kind: "ws.compiledPack",
    fields: { id: p.id, version: p.version, pin: pinOf(p), title: p.title, requiredFor: [...p.requiredFor] },
  })),
  rules: [worldReadiness],
};

const duplicates = <T>(xs: readonly T[], key: (x: T) => string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(key(x), (counts.get(key(x)) ?? 0) + 1);
  return new Map([...counts].filter(([, n]) => n > 1));
};

/** One `ws.duplicate` node per duplicated key, so a uniqueness rule has an EDB fact to derive from. */
export const duplicateNodes = <T>(collection: string, xs: readonly T[], key: (x: T) => string, nodeKey: (k: string) => string = (k) => k): TemplateNode[] =>
  [...duplicates(xs, key)].map(([k, count]) => ({
    id: nodeId.duplicate(collection, k), kind: "ws.duplicate", fields: { collection, key: nodeKey(k), count },
  }));

/** Ids that are unique within a list; a repeated id gets `#<index>` so `extends` merging by id keeps every entry. */
const uniqueIds = (ids: string[]): string[] => {
  const seen = duplicates(ids, (x) => x);
  return ids.map((id, i) => (seen.has(id) ? `${id}#${i}` : id));
};

/** Strips the `#<index>` suffix `uniqueIds` adds; the result is the Rust rule id. */
export const rustRuleOf = (constraintId: string): string => constraintId.replace(/#\d+$/, "");

const reserved = (what: string, name: string) => {
  if (name.startsWith(WS)) throw new Error(`World ${what} ${name} uses the reserved prefix ${WS}`);
};

export const worldTemplateRef = (snapshot: WorldSnapshot): string => `${worldTemplateId(snapshot)}@${worldTemplateVersion(snapshot)}`;
const worldTemplateId = (s: WorldSnapshot) => `template.world.${s.template.id}`;
/** meta@1 versions are integers; a non-numeric World Template version maps to 0 and stays in `ws.snapshot.templateVersion`. */
const worldTemplateVersion = (s: WorldSnapshot) => (/^\d+$/.test(s.template.version) ? Number(s.template.version) : 0);

/**
 * The ontology's criteria for the World object kinds, attached to every object shape of that kind. A World Template
 * does not carry them yet, so the adapter supplies them; kinds with `noun` or `instanceOf` are the probe's glossary.
 */
export const WORLD_KIND_CRITERIA: Record<string, KindCriteria> = {
  outcome: {
    noun: "outcome",
    instanceOf: "An outcome is a change for the beneficiary that the world aims for, not a task or a deliverable.",
    grounded: "It names who benefits, the change, and how it would be observed.",
    testable: "A testable outcome names an indicator, its baseline, its target, the horizon and the source of the measurement.",
    children: "Parts of one outcome must describe the same change for the same beneficiary and be reachable together within one horizon.",
    summary: "The outcome's description must name the change and beneficiary its parts measure or bring about.",
  },
  indicator: { testable: "A testable indicator names what is counted or observed, where it is recorded and the value that counts as success." },
  goal: {
    children: "Parts of one goal must be achievable by the same people at the same time; none may consume what another needs.",
    summary: "The goal's description must state the result its parts work toward and claim no result none of them pursues.",
  },
  thing: {
    children: "Parts of one thing must agree on what it holds, who may act on it and what each action changes.",
    summary: "The thing's description must name what its parts make up and the authority they share.",
  },
  task: {
    noun: "task",
    instanceOf: "A task is a unit of work the assistant or its user carries out.",
    grounded: "It names who does it, what is done and when it is finished.",
  },
  operation: {
    noun: "operation",
    instanceOf: "An operation is one action the system performs, with what it needs and what it changes.",
    grounded: "It names its inputs, its effect and its authorization.",
  },
  acceptanceCriterion: {
    noun: "acceptance criterion",
    instanceOf: "An acceptance criterion states a check whose condition passes or fails.",
    grounded: "It names the situation and the expected observable result.",
    testable: "A falsifiable criterion names the situation, the expected observable result and what counts as failing.",
  },
};

/**
 * The snapshot's World Template and Thing Templates as a meta@1 template source extending `template.meta.world@1`;
 * `criteria` (default `WORLD_KIND_CRITERIA`) are attached to the object shapes of those kinds.
 */
export function worldTemplateSource(snapshot: WorldSnapshot, criteria: Record<string, KindCriteria> = WORLD_KIND_CRITERIA): TemplateInput {
  const t = snapshot.template;
  for (const s of t.objectShapes) reserved("kind", s.kind);
  for (const e of t.allowedRelationEndpoints) reserved("relation", e.relationKind);
  const shapeKinds = [...new Set(t.objectShapes.map((s) => s.kind))].sort();
  const declared = new Set(shapeKinds);

  const kinds: Record<string, Kind | object> = {};
  for (const shape of t.objectShapes) {
    const rels = [...new Set(t.requiredRelations.filter((r) => r.subjectKind === shape.kind).map((r) => r.relationKind))].sort();
    kinds[shape.kind] = {
      fields: [...OBJECT_META_FIELDS.map((n) => str(n)), ...shape.requiredProperties.map((p) => str(p, true))],
      completeness: { relations: rels.map((rel) => ({ rel, cardinality: "1..*" })) },
      ...(criteria[shape.kind] && { criteria: criteria[shape.kind] }),
    };
  }
  const named = [...new Set(t.incompatibleConstraints.flatMap((c) => [c.left, c.right]))].sort();
  kinds["ws.activeConstraints"] = { fields: named.map(bool) };

  const relations: Record<string, Relation | object> = {};
  const relationKinds = [...new Set(t.allowedRelationEndpoints.map((e) => e.relationKind))].sort();
  for (const r of relationKinds) {
    const entries = t.allowedRelationEndpoints.filter((e) => e.relationKind === r);
    relations[r] = {
      from: [...new Set(entries.flatMap((e) => e.fromKinds))].sort(),
      to: [...new Set(entries.flatMap((e) => e.toKinds))].sort(),
    };
  }
  relations["ws.ofThing"] = { from: shapeKinds.length ? shapeKinds : ["ws.unshaped"], to: ["ws.thing"] };
  for (const [rel, from, to] of TYPED_REFERENCES) relations[rel] = { from: [from], to: [declared.has(to) ? to : "ws.unshaped"] };

  const cycleIds = uniqueIds(t.forbiddenCycles.map((c) => c.ruleId));
  const incompatibleIds = uniqueIds(t.incompatibleConstraints.map((c) => c.ruleId));
  const nodes: TemplateNode[] = [
    ...t.requiredRelations.map((r, i) => ({
      id: nodeId.requirement(i), kind: "ws.requirement",
      fields: { ruleId: r.ruleId, subjectKind: r.subjectKind, relationKind: r.relationKind, objectKind: r.objectKind, scopeId: r.scopeId, scope: nodeId.scope(r.scopeId) },
    })),
    ...[...new Set(t.requiredRelations.map((r) => r.scopeId))].sort().map((s) => ({ id: nodeId.scope(s), kind: "ws.scope", fields: { scopeId: s } })),
    ...t.allowedRelationEndpoints.map((e, i) => ({
      id: nodeId.endpoint(i), kind: "ws.endpoint", fields: { relationKind: e.relationKind, fromKinds: e.fromKinds, toKinds: e.toKinds },
    })),
    ...t.requiredRulePacks.map((p) => ({ id: nodeId.requiredPack(pinOf(p)), kind: "ws.requiredPack", fields: { id: p.id, version: p.version, pin: pinOf(p) } })),
    ...snapshot.thingTemplates.map((tt) => ({
      id: nodeId.thingTemplate(tt.id, tt.version), kind: "ws.thingTemplate",
      fields: {
        id: tt.id, version: tt.version, title: tt.title, inheritsWorldContext: tt.inheritsWorldContext,
        compatibleWorldTemplates: tt.compatibleWorldTemplates.map(pinOf), ...tt.capabilities,
      },
    })),
    ...duplicateNodes("shapes", [...t.objectShapes.map((s) => `id:${s.id}`), ...t.objectShapes.map((s) => `kind:${s.kind}`)], (k) => k),
    ...duplicateNodes("thingTemplates", snapshot.thingTemplates, (tt) => pinOf(tt)),
  ];

  return {
    id: worldTemplateId(snapshot),
    version: worldTemplateVersion(snapshot),
    meta: 1,
    extends: WORLD_BASE_REF,
    kinds: kinds as TemplateInput["kinds"],
    relations: relations as TemplateInput["relations"],
    constraints: {
      forbiddenCycles: t.forbiddenCycles.map((c, i) => ({ id: cycleIds[i], relations: c.relationKinds })),
      incompatible: t.incompatibleConstraints.map((c, i) => ({
        id: incompatibleIds[i], kind: "ws.activeConstraints", when: [{ field: c.left, value: true }, { field: c.right, value: true }],
      })),
      complete: t.requiredRelations.length ? [{ id: SCOPE_RULE, kind: "ws.scope" }] : [],
    },
    nodes,
  };
}

/** Loads the snapshot's World Template as a meta@1 `Template` over `template.meta.world@1`. */
export const worldTemplateToMeta = (snapshot: WorldSnapshot): Template =>
  loadTemplate(worldTemplateSource(snapshot), memoryStore([worldBase]));
