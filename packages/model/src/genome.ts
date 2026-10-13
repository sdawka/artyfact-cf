import {
  composeTemplates, GenomeTreeError, isLegacyGenome, loadTemplate, parseTree, projectTree, TemplateCompositionError,
  type GenomeFiles, type GenomeTree, type Graph, type GraphNode, type Template, type TemplateUse,
} from "@artyfact/ontology";
import { index, type ModelIndex } from "./model-index.ts";
import type * as schema from "./schema.ts";
import { KNOWN_KINDS } from "./schema.ts";

/**
 * `SystemModel` is a projection of the engine `Graph` that the codec reads from the Genome's node tree
 * (`docs/design/ontology.md` §2): the platform's consumers keep their shapes while the tree and the engine are the
 * source of truth. Only v2 Genomes load; a v1 (by-concern) layout is a `LegacyGenomeError`.
 */

export interface ParseIssue { path: PropertyKey[]; message: string }
/** A non-fatal problem found while loading. The node-tree schema is strict, so there are none today. */
export interface ModelWarning extends ParseIssue { file: string }

/** The Genome does not load: `file` is the first file with an issue, `issues` every issue found. */
export class ModelParseError extends Error {
  readonly file: string;
  readonly issues: ParseIssue[];
  constructor(file: string, issues: ParseIssue[]) {
    super(`${file}: ${issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ")}`);
    this.name = "ModelParseError";
    this.file = file;
    this.issues = issues;
  }
}

/** A revision in the retired v1 layout (`system.yaml` at the root): never loaded, shown as a legacy notice. */
export class LegacyGenomeError extends Error {
  readonly code = "legacy-genome";
  constructor() {
    super("this revision predates the node-tree Genome format");
    this.name = "LegacyGenomeError";
  }
}

/** The meta@1 template sources by ref (`metaTemplates` from `@artyfact/templates`). */
export interface TemplateStore { get(ref: string): unknown }

export interface SystemModel {
  revision?: string;
  system: schema.SystemFile;
  purposes: schema.Purpose[];
  externals: schema.Externals[];
  claims: schema.TheoryClaim[];
  description?: schema.Description;
  kits: schema.KitsFile;
  things: schema.ResolvedThing[];
  /** The templates the System and its Things pin (System first), from their `template` nodes. */
  templates: schema.Template[];
  /** Every node that is none of the kinds above: sections, screens, modules, endpoints, ... (any template kind). */
  nodes: schema.OntologyNode[];
  requirements: schema.Requirement[];
  criteria: schema.Criterion[];
  hooks: schema.AssayHook[];
  journeys: schema.Journey[];
  evolutions: schema.Evolution[];
  /** id → the Genome file that declares it (`<dir>/node.yaml`, or `evolutions/<id>.yaml`). */
  origin: Record<string, string>;
  warnings: ModelWarning[];
  /** The engine graph the model is projected from. */
  graph: Graph;
  /** The template the Genome is evaluated against: the System's composed with its Things' (`composeTemplates`). */
  template: Template;
  index: ModelIndex;
}

export interface LoadOptions { revision?: string; templates: TemplateStore }

/** Reads a v2 Genome (path → text) into a `SystemModel`. Throws `LegacyGenomeError` or `ModelParseError`. */
export function loadGenome(files: GenomeFiles, opts: LoadOptions): SystemModel {
  const paths = files instanceof Map ? [...files.keys()] : Object.keys(files);
  if (isLegacyGenome(paths)) throw new LegacyGenomeError();
  let tree: GenomeTree, graph: Graph;
  try {
    tree = parseTree(files);
    graph = projectTree(tree, opts.templates);
  } catch (e) {
    if (e instanceof GenomeTreeError) throw new ModelParseError(e.issues[0]?.path ?? "node.yaml", e.issues.map((i) => ({ path: [i.path], message: i.message })));
    throw e;
  }
  return fromGraph(graph, opts.templates, tree, opts.revision);
}

const loaded = new WeakMap<TemplateStore, Map<string, Template>>();

/** A template from `store` merged over its `extends` chain, memoised per store. */
function templateOf(store: TemplateStore, ref: string, at: string): Template {
  const memo = loaded.get(store) ?? new Map<string, Template>();
  loaded.set(store, memo);
  const hit = memo.get(ref);
  if (hit) return hit;
  const raw = store.get(ref);
  if (raw === undefined) throw new ModelParseError(at, [{ path: ["template"], message: `unknown template ${ref}` }]);
  const t = loadTemplate(raw, store);
  memo.set(ref, t);
  return t;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);
const opt = <K extends string, V>(key: K, v: V | undefined) => (v === undefined ? {} : { [key]: v } as { [P in K]: V });
const pins = (v: unknown): schema.Pin[] =>
  list<unknown>(v).flatMap((p) => (isObj(p) && typeof p.id === "string" ? [{ id: p.id, version: String(p.version ?? "") }] : []));

/** Relations the projection reads into dedicated fields; every other outgoing link of a node is a cross link. */
const STRUCTURAL = new Set(["refines"]);
const KNOWN = new Set<string>(KNOWN_KINDS);

/**
 * Projects the engine graph onto `SystemModel`. `tree` is the codec's index of the same Genome: it holds what the
 * graph does not carry (each node's file, its `template` ref, the `kits`/`rulePacks` pins, link labels and sources).
 */
export function fromGraph(graph: Graph, templates: TemplateStore, tree: GenomeTree, revision?: string): SystemModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Graph["links"]>();
  for (const l of graph.links) out.set(l.from, [...(out.get(l.from) ?? []), l]);
  const linksOf = (id: string, rel: string) => (out.get(id) ?? []).filter((l) => l.rel === rel).map((l) => l.to);
  const linkTo = (id: string, rel: string) => linksOf(id, rel)[0];
  const ofKind = (kind: string) => graph.nodes.filter((n) => n.kind === kind);
  const childrenOf = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) if (n.parent !== undefined) childrenOf.set(n.parent, [...(childrenOf.get(n.parent) ?? []), n]);
  const fileOf = (id: string) => tree.nodes.get(id)?.file;
  const nameOf = (n: GraphNode) => str(n.fields.name) ?? str(n.fields.title) ?? n.id;
  const thingAbove = (id: string): string | undefined => {
    for (let n = byId.get(id); n; n = n.parent === undefined ? undefined : byId.get(n.parent)) if (n.kind === "thing") return n.id;
    return undefined;
  };
  /** Outgoing cross links of `id` with their tree-only `label` and `source`. */
  const crossLinks = (id: string): schema.CrossLink[] => {
    const declared = fileOf(id)?.links ?? [];
    return (out.get(id) ?? []).filter((l) => !STRUCTURAL.has(l.rel)).map((l) => {
      const d = declared.find((x) => x.rel === l.rel && x.to === l.to);
      return {
        rel: l.rel, to: l.to, direction: "out" as const, certainty: (l.certainty ?? "declared") as schema.Certainty,
        ...opt("label", d?.label), ...opt("source", d?.source),
      };
    });
  };

  const root = byId.get(tree.root)!;
  const rootFields = tree.nodes.get(tree.root)!.file.fields ?? {};
  const thingNodes = ofKind("thing");
  const system: schema.SystemFile = {
    id: root.id, name: nameOf(root), template: fileOf(root.id)?.template ?? null, ...opt("profile", str(root.fields.profile)),
    things: thingNodes.map((t) => t.id), phase: str(root.fields.phase) ?? "unrealized", ...opt("head", str(root.fields.head)),
    purposes: strs(root.fields.purposes),
  };
  const kits: schema.KitsFile = { kits: pins(rootFields.kits), rulePacks: pins(rootFields.rulePacks), required: strs(rootFields.required) };

  const things = thingNodes.map((t): schema.ResolvedThing => {
    const f = t.fields;
    return {
      id: t.id, name: nameOf(t), templateRef: fileOf(t.id)?.template ?? null, description: str(f.description) ?? "",
      artifacts: linksOf(t.id, "artifact").map((a) => {
        const af = byId.get(a)?.fields ?? {};
        return { artifact: a, type: af.type as schema.ArtifactBinding["type"], ...opt("repo", str(af.repo)), ...opt("commit", str(af.commit)), scope: strs(af.scope) };
      }),
      parts: list(f.parts), ...opt("composition", f.composition as schema.Thing["composition"]),
      sections: strs(f.sections), purposeRefs: strs(f.purposeRefs),
    };
  });

  const purposes = ofKind("purpose").map((n): schema.Purpose => ({
    id: n.id, statement: str(n.fields.statement) ?? "", beneficiaries: linksOf(n.id, "beneficiary"), intendedChange: str(n.fields.intendedChange) ?? "",
    successCriteria: strs(n.fields.successCriteria), nonGoals: strs(n.fields.nonGoals), constraints: strs(n.fields.constraints),
    ...opt("source", n.fields.source as schema.Source | undefined),
  }));
  const externals = ofKind("external").map((n): schema.Externals => ({
    id: n.id, kind: n.fields.kind as schema.Externals["kind"], name: nameOf(n), modeled: str(n.fields.modeled) ?? "", external: str(n.fields.external) ?? "",
    links: crossLinks(n.id), ...opt("source", n.fields.source as schema.Source | undefined),
  }));
  const claims = ofKind("claim").map((n): schema.TheoryClaim => ({
    id: n.id, name: nameOf(n), purpose: str(n.fields.purpose) ?? "", mechanism: str(n.fields.mechanism) ?? "",
    beneficiaries: linksOf(n.id, "beneficiary"), activities: strs(n.fields.activities), outcome: str(n.fields.outcome) ?? "",
    indicator: str(n.fields.indicator) ?? "", evaluationMethod: str(n.fields.evaluationMethod) ?? "", limitation: str(n.fields.limitation) ?? "",
    kind: (str(n.fields.kind) ?? "hypothesis") as schema.TheoryClaim["kind"], status: (str(n.fields.status) ?? "unknown") as schema.TheoryClaim["status"],
    deferred: bool(n.fields.deferred, false),
  }));
  const features = ofKind("feature").map((n): schema.GDFeature => ({
    id: n.id, name: nameOf(n), summary: str(n.fields.summary) ?? "", deferred: bool(n.fields.deferred, false), ...opt("source", n.fields.source as schema.Source | undefined),
  }));
  const commitments = ofKind("commitment").map((n): schema.Commitment => ({
    id: n.id, statement: str(n.fields.statement) ?? "", features: strs(n.fields.features), coupledWith: strs(n.fields.coupledWith),
    ...opt("source", n.fields.source as schema.Source | undefined),
  }));
  const narrative = str(root.fields.narrative);
  const description: schema.Description | undefined = narrative !== undefined || features.length || commitments.length
    ? { narrative: narrative ?? "", features, commitments, alternatives: strs(root.fields.alternatives), openQuestions: strs(root.fields.openQuestions) }
    : undefined;

  const nodes = graph.nodes.filter((n) => !KNOWN.has(n.kind)).map((n): schema.OntologyNode => {
    const f = n.fields;
    return {
      ...f,
      id: n.id, kind: n.kind, name: nameOf(n), ...opt("parent", n.parent), ...opt("owningThing", str(f.owningThing) ?? thingAbove(n.id)),
      revision: typeof f.revision === "number" ? f.revision : 1, ...opt("description", str(f.description)), ...opt("source", f.source as schema.Source | undefined),
      refines: linksOf(n.id, "refines"), links: crossLinks(n.id), ...opt("route", str(f.route)), ...opt("cardinality", str(f.cardinality)),
      states: strs(f.states), roles: strs(f.roles), ...opt("actor", str(f.actor)), ...opt("trigger", str(f.trigger)),
      preconditions: strs(f.preconditions), effects: strs(f.effects), failure: strs(f.failure), fields: list(f.fields), invariants: strs(f.invariants),
      provisional: n.provisional === true, ...opt("mode", str(f.mode)), ...opt("fromTemplate", str(f.fromTemplate)),
    };
  });

  const requirements = ofKind("requirement").map((n): schema.Requirement => ({
    id: n.id, thing: str(n.fields.thing) ?? thingAbove(n.id) ?? "", title: str(n.fields.title) ?? nameOf(n), text: str(n.fields.text) ?? "",
    refines: linksOf(n.id, "refines"), subjects: linksOf(n.id, "subject"), enabled: bool(n.fields.enabled, true),
    ...opt("source", n.fields.source as schema.Source | undefined),
  }));

  const criteria = ofKind("criterion").map((n): schema.Criterion => {
    const f = n.fields;
    return {
      id: n.id, version: typeof f.version === "number" ? f.version : 1, title: str(f.title) ?? str(f.claim) ?? n.id, claim: str(f.claim) ?? "",
      ownerKind: f.ownerKind as schema.Criterion["ownerKind"], ownerId: linkTo(n.id, "owner") ?? "", subjectKind: str(f.subjectKind) ?? "",
      subjectId: linkTo(n.id, "subject") ?? "", targetKind: (str(f.targetKind) ?? "model") as schema.TargetKind, sourceRefs: linksOf(n.id, "sourceRef"),
      refines: linksOf(n.id, "refines"), satisfies: strs(f.satisfies), severity: (str(f.severity) ?? "hard") as schema.Criterion["severity"],
      gates: strs(f.gates) as schema.Gate[], ...opt("applicableWhen", str(f.applicableWhen)), deferred: bool(f.deferred, false), hooks: strs(f.hooks),
      ...opt("fromTemplate", str(f.fromTemplate)),
    };
  });
  const hooks = ofKind("hook").map((n): schema.AssayHook => {
    const f = n.fields;
    return {
      id: n.id, version: typeof f.version === "number" ? f.version : 1, assay: str(f.assay) ?? "", criteria: strs(f.criteria),
      tier: f.tier as schema.AssayHook["tier"], engine: f.engine as schema.AssayHook["engine"], targetKind: (str(f.targetKind) ?? "model") as schema.TargetKind,
      triggers: strs(f.triggers) as schema.Gate[], inputs: (isObj(f.inputs) ? f.inputs : {}) as Record<string, string>,
      ...opt("verdictMapping", isObj(f.verdictMapping) ? f.verdictMapping as Record<string, string> : undefined),
      timeoutMs: typeof f.timeoutMs === "number" ? f.timeoutMs : 60000, costTier: (str(f.costTier) ?? "free") as schema.AssayHook["costTier"],
      binding: (str(f.binding) ?? "defined") as schema.AssayHook["binding"], ...opt("fromTemplate", str(f.fromTemplate)),
    };
  });

  const journeys = ofKind("journey").map((j): schema.Journey => {
    const f = j.fields;
    const start = str(f.start) ?? "";
    return {
      id: j.id, name: nameOf(j), actorGoal: str(f.actorGoal) ?? "", features: strs(f.features), requirements: strs(f.requirements), start,
      steps: inSequence((childrenOf.get(j.id) ?? []).filter((s) => s.kind === "step").map((s) => step(j.id, s)), start),
      deferred: bool(f.deferred, false), ...opt("segments", Array.isArray(f.segments) ? f.segments as schema.Journey["segments"] : undefined),
    };
  });
  function step(journey: string, s: GraphNode): schema.JourneyStep {
    const f = s.fields;
    const unresolved = bool(f.unresolved, false);
    const target = (rel: string, field: string) => (unresolved ? str(f[field]) : linkTo(s.id, rel));
    return {
      id: str(f.step) ?? s.id.slice(journey.length + 1), actor: f.actor as schema.JourneyStep["actor"], action: str(f.action) ?? "",
      ...opt("screen", target("stepScreen", "screen")), ...opt("operation", target("stepOperation", "operation")),
      ...opt("state", str(f.state)), ...opt("external", target("stepExternal", "external")),
      kind: (str(f.kind) ?? "action") as schema.JourneyStep["kind"], next: list(f.next), requirementRefs: strs(f.requirementRefs), unresolved,
    };
  }

  const evolutions: schema.Evolution[] = tree.evolutions.map((e) => e.evolution);

  const tplNodes = new Map(ofKind("template").map((n) => [n.id, n]));
  const refs = [...new Set([system.template, ...things.map((t) => t.templateRef)].filter((r): r is string => !!r))];
  const projectedTemplates = refs.map((ref): schema.Template => {
    const f = tplNodes.get(ref)?.fields ?? {};
    const at = ref.lastIndexOf("@");
    return {
      id: ref.slice(0, at), kind: (str(f.kind) ?? /^template\.(\w+)\./.exec(ref)?.[1] ?? "thing") as schema.Template["kind"],
      version: str(f.version) ?? ref.slice(at + 1), name: str(f.name) ?? ref, ...opt("description", str(f.description)), sections: strs(f.sections),
      nodes: nodes.filter((n) => n.fromTemplate === ref), criteria: criteria.filter((c) => c.fromTemplate === ref), hooks: hooks.filter((h) => h.fromTemplate === ref),
      ...opt("scaffold", isObj(f.scaffold) ? f.scaffold as schema.Template["scaffold"] : undefined),
      ...opt("sourceMapDefaults", Array.isArray(f.sourceMapDefaults) ? f.sourceMapDefaults as schema.Template["sourceMapDefaults"] : undefined),
      requires: strs(f.requires),
    };
  });

  const origin: Record<string, string> = {};
  for (const n of tree.nodes.values()) {
    origin[n.id] = n.path;
    for (const c of n.file.criteria ?? []) {
      origin[c.id] = n.path;
      for (const h of c.hooks ?? []) if (typeof h !== "string") origin[h.id] = n.path;
    }
  }
  for (const e of tree.evolutions) origin[e.evolution.id] = e.path;

  const model = {
    ...opt("revision", revision), system, purposes, externals, claims, ...opt("description", description), kits, things, templates: projectedTemplates,
    nodes, requirements, criteria, hooks, journeys, evolutions, origin, warnings: [], graph, template: composed(graph, templates, tree),
  };
  return { ...model, index: index(model) };
}

/** The System template composed with the template of every node below the root that pins one. */
function composed(graph: Graph, templates: TemplateStore, tree: GenomeTree): Template {
  const rootPath = tree.nodes.get(tree.root)!.path;
  const uses: TemplateUse[] = [...tree.nodes.values()]
    .filter((n) => n.id !== tree.root && n.file.template !== undefined)
    .map((n) => ({ template: templateOf(templates, n.file.template!, n.path), self: n.id }));
  try {
    return composeTemplates({ template: templateOf(templates, graph.template, rootPath), self: tree.root }, uses);
  } catch (e) {
    if (e instanceof TemplateCompositionError) throw new ModelParseError(rootPath, [{ path: ["template"], message: e.message }]);
    throw e;
  }
}

/** Steps from `start` along `next` (breadth first), then any step the walk did not reach, in tree order. */
function inSequence(steps: schema.JourneyStep[], start: string): schema.JourneyStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const queue = byId.has(start) ? [start] : [];
  const order: schema.JourneyStep[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = byId.get(id)!;
    order.push(s);
    for (const n of s.next) if (byId.has(n.to) && !seen.has(n.to)) queue.push(n.to);
  }
  return [...order, ...steps.filter((s) => !seen.has(s.id))];
}
