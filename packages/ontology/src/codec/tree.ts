import { parseDocument } from "yaml";
import { z } from "zod";
import { byKey } from "../canon.ts";
import type { Graph, GraphLink, GraphNode } from "../graph/graph.ts";
import { EVOLUTIONS_DIR, isNodeSlug, NODE_FILE, NodeFileSchema, type NodeCriterion, type NodeFile, type NodeHook } from "../genome/node.ts";

/**
 * The Genome v2 tree codec: `node.yaml` files in nested directories become the engine `Graph`. Design:
 * `docs/design/ontology.md` §2 ("From the tree to the engine Graph").
 */

/** A Genome as repo-relative path -> text; only `node.yaml` files and `evolutions/*.yaml` are read. */
export type GenomeFiles = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

/** The base template a Genome whose root pins none is evaluated under. */
export const BASE_TEMPLATE = "template.meta.artyfact-genome@1";

/**
 * The meta@1 template sources by ref (the engine's `TemplateStore`; `@artyfact/templates` exports `metaTemplates`).
 * `readTree` reads only the `template` node a template declares for itself in `nodes`.
 */
export interface TreeTemplates { get(ref: string): unknown }

export interface TreeIssue { path: string; message: string }

export class GenomeTreeError extends Error {
  readonly issues: TreeIssue[];
  constructor(issues: TreeIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "GenomeTreeError";
    this.issues = issues;
  }
}

/** One node of the tree: its directory (`""` for the root), the `node.yaml` path and the parsed file. */
export interface TreeNode {
  id: string;
  dir: string;
  path: string;
  parent?: string;
  file: NodeFile;
  children: string[];
}

export interface GenomeTree {
  root: string;
  /** In sorted path order, so a walk is deterministic. */
  nodes: Map<string, TreeNode>;
  evolutions: { path: string; evolution: Evolution }[];
}

/** Change records, the v1 `Evolution` unchanged. */
export const EvolutionSchema = z.object({
  id: z.string().regex(/^evolution\.[\w.-]+$/),
  title: z.string(),
  intent: z.string(),
  state: z.enum(["proposed", "genome-approved", "actionable", "realizing", "evaluated", "promoted", "rejected", "withdrawn"]),
  baseRevision: z.string().optional(),
  kind: z.enum(["implementation", "genome-amendment", "mixed"]),
  affectedNodes: z.array(z.string().min(1)),
  affectedClaims: z.array(z.string()).default([]),
  genomeDelta: z.array(z.object({ op: z.enum(["add", "change", "remove"]), path: z.string(), summary: z.string() })).default([]),
  acceptanceCriteria: z.array(z.string().regex(/^C\./)),
  requiredEvidence: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  realizations: z.array(z.string()).default([]),
  decision: z.string().optional(),
});
export type Evolution = z.infer<typeof EvolutionSchema>;

export const normPath = (p: string): string => p.replace(/\\/g, "/").replace(/^\.?\//, "");
export const entriesOf = (files: GenomeFiles): [string, string][] =>
  (files instanceof Map ? [...files] : Object.entries(files)).map(([p, t]) => [normPath(p), t]);

const dirOf = (path: string) => (path === NODE_FILE ? "" : path.slice(0, -(NODE_FILE.length + 1)));
const parentDir = (dir: string) => (dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");
/** Dot-files, dot-directories and `README.md` are never part of the Genome. */
const ignored = (path: string) => path.split("/").some((s) => s.startsWith(".")) || /(^|\/)README\.md$/.test(path);

function parseYamlFile(path: string, text: string, issues: TreeIssue[]): unknown {
  const doc = parseDocument(text);
  if (doc.errors.length) {
    issues.push(...doc.errors.map((e) => ({ path, message: e.message })));
    return undefined;
  }
  return doc.toJS() ?? {};
}

const zodIssues = (path: string, e: z.ZodError): TreeIssue[] =>
  e.issues.map((i) => ({ path, message: (i.path.length ? `${i.path.join(".")}: ` : "") + i.message }));

/**
 * Parses and checks the tree's structure: every `node.yaml` against `NodeFileSchema`, slugs, one root, a node in
 * every directory between a node and the root, nothing but change records under `evolutions/`, ids (nodes,
 * criteria, inline hooks, evolutions) unique, and every hook a criterion names declared inline somewhere. Throws `GenomeTreeError` with every issue found.
 */
export function parseTree(files: GenomeFiles): GenomeTree {
  const issues: TreeIssue[] = [];
  const entries = entriesOf(files).filter(([p]) => !ignored(p)).sort(byKey(([p]) => p));
  const byDir = new Map<string, TreeNode>();
  const evolutions: GenomeTree["evolutions"] = [];
  const ids = new Map<string, string>();
  const hookIds = new Set<string>();
  const claim = (id: string, path: string) => {
    const prev = ids.get(id);
    if (prev !== undefined) issues.push({ path, message: `duplicate id ${id} (also in ${prev})` });
    else ids.set(id, path);
  };

  for (const [path, text] of entries) {
    const segments = path.split("/");
    if (segments[0] === EVOLUTIONS_DIR && segments.length > 1) {
      if (segments.length > 2 || segments[1] === NODE_FILE) issues.push({ path, message: `${EVOLUTIONS_DIR}/ holds only flat change records` });
      else if (/\.ya?ml$/.test(path)) {
        const raw = parseYamlFile(path, text, issues);
        const r = raw === undefined ? undefined : EvolutionSchema.safeParse(raw);
        if (r && !r.success) issues.push(...zodIssues(path, r.error));
        else if (r) { claim(r.data.id, path); evolutions.push({ path, evolution: r.data }); }
      }
      continue;
    }
    if (segments[segments.length - 1] !== NODE_FILE) continue;
    const dir = dirOf(path);
    const bad = dir ? segments.slice(0, -1).find((s) => !isNodeSlug(s)) : undefined;
    if (bad !== undefined) { issues.push({ path, message: `directory name ${JSON.stringify(bad)} is not a node slug` }); continue; }
    const raw = parseYamlFile(path, text, issues);
    if (raw === undefined) continue;
    const r = NodeFileSchema.safeParse(raw);
    if (!r.success) { issues.push(...zodIssues(path, r.error)); continue; }
    claim(r.data.id, path);
    for (const c of r.data.criteria ?? []) {
      claim(c.id, path);
      for (const h of c.hooks ?? []) if (typeof h !== "string") { claim(h.id, path); hookIds.add(h.id); }
    }
    byDir.set(dir, { id: r.data.id, dir, path, file: r.data, children: [] });
  }

  for (const n of byDir.values()) {
    for (const c of n.file.criteria ?? []) {
      for (const h of c.hooks ?? []) {
        if (typeof h === "string" && !hookIds.has(h)) issues.push({ path: n.path, message: `criterion ${c.id} names hook ${h}, which no criterion declares` });
      }
    }
  }
  const root = byDir.get("");
  if (!root) issues.push({ path: NODE_FILE, message: "missing the root node.yaml" });
  const nodes = new Map<string, TreeNode>();
  for (const n of byDir.values()) {
    if (n.dir) {
      const parent = byDir.get(parentDir(n.dir));
      if (!parent) { issues.push({ path: n.path, message: `no ${NODE_FILE} in the enclosing directory ${parentDir(n.dir) || "(root)"}` }); continue; }
      n.parent = parent.id;
      parent.children.push(n.id);
    }
    nodes.set(n.id, n);
  }
  if (issues.length) throw new GenomeTreeError(issues);
  return { root: root!.id, nodes, evolutions };
}

const isEmpty = (v: unknown) =>
  v === undefined || (Array.isArray(v) && !v.length) || (!!v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const compact = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => !isEmpty(v)));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

class Builder {
  nodes: GraphNode[] = [];
  links: GraphLink[] = [];
  private seenNodes = new Set<string>();
  private seenLinks = new Set<string>();
  node(n: GraphNode) {
    const key = JSON.stringify([n.id, n.kind]);
    if (this.seenNodes.has(key)) return;
    this.seenNodes.add(key);
    this.nodes.push(n);
  }
  link(l: GraphLink) {
    const key = JSON.stringify([l.from, l.rel, l.to]);
    if (this.seenLinks.has(key)) return;
    this.seenLinks.add(key);
    this.links.push(l.certainty === undefined ? { from: l.from, rel: l.rel, to: l.to } : l);
  }
}

/**
 * The `template` node for `ref`: the node a meta@1 template declares for itself (`{id: ref, kind: template}` in its
 * `nodes`), else one holding only its kind and version. Undefined when the store does not know `ref`.
 */
const SELF = "$self";

function templateNode(templates: TreeTemplates, ref: string): GraphNode | undefined {
  const t = templates.get(ref);
  if (!isObj(t)) return undefined;
  const own = Array.isArray(t.nodes) ? t.nodes.find((n) => isObj(n) && n.id === ref && n.kind === "template") : undefined;
  const kind = /^template\.([\w-]+)\./.exec(ref)?.[1];
  const fields = isObj(own) && isObj(own.fields) ? own.fields : compact({ kind, version: t.version === undefined ? undefined : String(t.version) });
  return { id: ref, kind: "template", fields };
}

/**
 * Projects a v2 Genome onto the engine `Graph`. Criteria become parentless `criterion` nodes with `owner` and
 * `subject` links, inline hooks `hook` nodes, change records `evolution` nodes; the root's `kits`, `required` and
 * `rulePacks`, a Thing's `artifacts`, a step's `next` and every `template` pin become the nodes and links the v1
 * adapter derived from them. Absent defaults are filled as v1 filled them (link certainty `declared`, criterion
 * severity `hard` and target `model`, ...), so a converted Genome projects to the v1 graph. Same files, same graph.
 */
export function readTree(files: GenomeFiles, templates: TreeTemplates): Graph {
  return projectTree(parseTree(files), templates);
}

export function projectTree(tree: GenomeTree, templates: TreeTemplates): Graph {
  const issues: TreeIssue[] = [];
  const b = new Builder();
  const { nodes } = tree;
  const rootFile = nodes.get(tree.root)!.file;

  const ownerOf = (id: string): TreeNode => {
    let n = nodes.get(id)!;
    while (n.parent !== undefined && n.file.template === undefined && n.file.kind !== "thing") n = nodes.get(n.parent)!;
    return n;
  };
  const pinTemplate = (n: TreeNode, ref: string) => {
    const t = templateNode(templates, ref);
    if (!t) issues.push({ path: n.path, message: `unknown template ${ref}` });
    else b.node(t);
    b.link({ from: n.id, rel: "pinned", to: ref });
    // A criterion the template requires under a `$self` id is this node's own: `requires` names it (C.$self.checks → C.<id>.checks).
    const required = t?.fields.criteria;
    for (const c of Array.isArray(required) ? required : []) {
      if (typeof c === "string" && c.includes(SELF)) b.link({ from: n.id, rel: "requires", to: c.replaceAll(SELF, n.id) });
    }
  };

  // Inline hooks first, so a criterion may name a hook declared further down the tree.
  const hooks = new Map<string, { hook: NodeHook; target: string; criteria: string[] }>();
  for (const n of nodes.values()) {
    for (const c of n.file.criteria ?? []) {
      for (const h of c.hooks ?? []) if (typeof h !== "string") hooks.set(h.id, { hook: h, target: c.target ?? "model", criteria: [] });
    }
  }

  for (const n of nodes.values()) {
    const f = n.file;
    const fields: Record<string, unknown> = { ...(f.fields ?? {}) };
    if (n.id === tree.root) {
      const kits = fields.kits, required = fields.required, packs = fields.rulePacks;
      delete fields.kits; delete fields.required;
      if (Array.isArray(packs)) fields.rulePacks = packs.map((p) => (isObj(p) ? `${p.id}@${p.version}` : p));
      const purposes = n.children.filter((c) => nodes.get(c)!.file.kind === "purpose");
      if (purposes.length) fields.purposes = purposes;
      for (const k of Array.isArray(kits) ? kits : []) {
        if (!isObj(k) || typeof k.id !== "string") { issues.push({ path: n.path, message: "fields.kits: expected {id, version} entries" }); continue; }
        b.node({ id: k.id, kind: "kit", fields: compact({ version: k.version }) });
        b.link({ from: n.id, rel: "pinned", to: k.id });
      }
      for (const k of Array.isArray(required) ? required : []) {
        if (typeof k !== "string") { issues.push({ path: n.path, message: "fields.required: expected kit ids" }); continue; }
        b.node({ id: k, kind: "kit", fields: {} });
        b.link({ from: n.id, rel: "requires", to: k });
      }
    }
    if (f.kind === "thing" && "artifacts" in fields) {
      const artifacts = fields.artifacts;
      delete fields.artifacts;
      for (const a of Array.isArray(artifacts) ? artifacts : []) {
        if (!isObj(a) || typeof a.artifact !== "string") { issues.push({ path: n.path, message: "fields.artifacts: expected {artifact, type} entries" }); continue; }
        b.node({ id: a.artifact, kind: "artifact", fields: compact({ type: a.type, repo: a.repo, commit: a.commit, scope: a.scope }) });
        b.link({ from: n.id, rel: "artifact", to: a.artifact });
      }
    }
    b.node({ id: n.id, kind: f.kind, ...(n.parent !== undefined && { parent: n.parent }), fields, ...(f.provisional && { provisional: true }) });
    if (f.template !== undefined) pinTemplate(n, f.template);
    // A link's `label` and `source` stay in node.yaml: the engine graph link has no slot for them.
    for (const l of f.links ?? []) b.link({ from: n.id, rel: l.rel, to: l.to, certainty: l.certainty ?? "declared" });
    if (f.kind === "step" && Array.isArray(fields.next) && n.parent !== undefined) {
      for (const s of fields.next) if (isObj(s) && typeof s.to === "string") b.link({ from: n.id, rel: "stepNext", to: `${n.parent}/${s.to}` });
    }

    for (const c of f.criteria ?? []) {
      const owner = ownerOf(n.id);
      b.node({ id: c.id, kind: "criterion", fields: criterionFields(c, owner.file.kind, f.kind) });
      b.link({ from: c.id, rel: "owner", to: owner.id });
      b.link({ from: c.id, rel: "subject", to: n.id });
      for (const to of c.sourceRefs ?? []) b.link({ from: c.id, rel: "sourceRef", to });
      for (const to of c.refines ?? []) b.link({ from: c.id, rel: "refines", to });
      for (const h of c.hooks ?? []) {
        const id = typeof h === "string" ? h : h.id;
        hooks.get(id)?.criteria.push(c.id);
      }
    }
  }
  for (const [id, { hook: h, target, criteria }] of hooks) {
    b.node({ id, kind: "hook", fields: compact({
      version: h.version ?? 1, assay: h.assay, criteria, tier: h.tier, engine: h.engine, targetKind: h.target ?? target,
      triggers: h.triggers, inputs: h.inputs, verdictMapping: h.verdictMapping, timeoutMs: h.timeoutMs ?? 60000,
      costTier: h.costTier ?? "free", binding: h.binding ?? "defined", fromTemplate: h.fromTemplate,
    }) });
  }
  for (const { evolution: e } of tree.evolutions) {
    b.node({ id: e.id, kind: "evolution", fields: compact({
      title: e.title, intent: e.intent, state: e.state, baseRevision: e.baseRevision, kind: e.kind, affectedClaims: e.affectedClaims,
      genomeDelta: e.genomeDelta, requiredEvidence: e.requiredEvidence, dependsOn: e.dependsOn, risk: e.risk, realizations: e.realizations, decision: e.decision,
    }) });
    for (const to of e.acceptanceCriteria) b.link({ from: e.id, rel: "acceptance", to });
    for (const to of e.affectedNodes) b.link({ from: e.id, rel: "affects", to });
  }
  if (issues.length) throw new GenomeTreeError(issues);
  return { template: rootFile.template ?? BASE_TEMPLATE, nodes: b.nodes, links: b.links, declarations: [], evidence: [] };
}

/** A criterion's node fields; `ownerKind` and `subjectKind` come from where it is declared. */
const criterionFields = (c: NodeCriterion, ownerKind: string, subjectKind: string) => compact({
  version: c.version ?? 1, title: c.title, claim: c.claim, ownerKind, subjectKind, targetKind: c.target ?? "model",
  severity: c.severity ?? "hard", gates: c.gates, applicableWhen: c.applicableWhen, deferred: c.deferred ?? false,
  hooks: c.hooks?.map((h) => (typeof h === "string" ? h : h.id)), satisfies: c.satisfies, fromTemplate: c.fromTemplate,
});
