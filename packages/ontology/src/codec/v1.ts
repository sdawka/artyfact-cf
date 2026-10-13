import { loadSystem, schema, type SystemModel, type TemplateStore } from "@artyfact/model";
import { ontologyFields } from "../adapters/artyfact/graph.ts";
import { artyfactTemplateStore } from "../adapters/artyfact/templates.ts";
import { EVOLUTIONS_DIR, NODE_FILE, slugOf, type NodeCriterion, type NodeFile, type NodeHook, type NodeLink } from "../genome/node.ts";
import { entriesOf, GenomeTreeError, type GenomeFiles, type TreeIssue } from "./tree.ts";
import { formatNodeFile } from "./write.ts";

/**
 * The one-time v1 -> v2 Genome converter (`docs/design/ontology.md` §2a, "v1 → v2 conversion"). It reads the v1
 * (by-concern) layout through `@artyfact/model`, which knows Parts and Composition, and writes the node tree. It is
 * the only v1 reader that outlives the v1 adapter, and goes with it after the migration release.
 */

const isEmpty = (v: unknown) =>
  v === undefined || (Array.isArray(v) && !v.length) || (!!v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const compact = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => !isEmpty(v)));

interface Draft { id: string; kind: string; parent?: string; slug: string; file: NodeFile }

/**
 * Converts a v1 Genome (path -> text) into the v2 tree (path -> text, sorted). `templates` is a store or the artyfact
 * templates directory as path -> text (`thing/<name>@<v>/template.yaml`, ...). Template-prefilled nodes, criteria and
 * hooks are written out with their `fromTemplate`, as the v2 codec expects. Throws `GenomeTreeError` when the v1
 * Genome cannot be placed losslessly: a node whose parent is unknown, a criterion whose owner is not the nearest
 * Thing or System above its subject, a hook no criterion names, an inbound link to something that is not a node.
 */
export function convertV1(files: GenomeFiles, templates?: TemplateStore | Record<string, string>): Map<string, string> {
  const store = templates === undefined || typeof templates.get === "function" ? templates as TemplateStore | undefined
    : artyfactTemplateStore(templates as Record<string, string>) as TemplateStore;
  const m = loadSystem(new Map(entriesOf(files)), { templates: store });
  const issues: TreeIssue[] = [];
  const drafts = new Map<string, Draft>();
  const add = (d: Omit<Draft, "slug"> & { slug?: string }, origin: string) => {
    if (drafts.has(d.id)) { issues.push({ path: origin, message: `duplicate node id ${d.id}` }); return; }
    drafts.set(d.id, { ...d, slug: d.slug ?? slugOf(d.id) });
  };
  const linkOut = (from: string, l: NodeLink, origin: string) => {
    const d = drafts.get(from);
    if (!d) { issues.push({ path: origin, message: `cannot place the ${l.rel} link from ${from} to ${l.to}: ${from} is not a node` }); return; }
    const links = (d.file.links ??= []);
    if (!links.some((x) => x.rel === l.rel && x.to === l.to)) links.push(l);
  };
  const cross = (owner: string, l: schema.CrossLink, origin: string) => {
    const certainty = l.certainty === "declared" ? {} : { certainty: l.certainty };
    if (l.direction === "in") linkOut(l.to, { rel: l.rel, to: owner, ...certainty }, origin);
    else linkOut(owner, { rel: l.rel, to: l.to, ...certainty }, origin);
  };
  const origin = (id: string) => m.origin[id] ?? "system.yaml";

  const s = m.system;
  add({ id: s.id, kind: "system", slug: "", file: {
    id: s.id, kind: "system", ...(s.template && { template: s.template }),
    fields: compact({
      name: s.name, profile: s.profile, phase: s.phase, head: s.head,
      kits: m.kits.kits, rulePacks: m.kits.rulePacks, required: m.kits.required,
      narrative: m.description?.narrative, alternatives: m.description?.alternatives, openQuestions: m.description?.openQuestions,
    }),
  } }, "system.yaml");
  for (const t of m.things) {
    add({ id: t.id, kind: "thing", parent: s.id, file: {
      id: t.id, kind: "thing", ...(t.templateRef && { template: t.templateRef }),
      fields: compact({ name: t.name, description: t.description, purposeRefs: t.purposeRefs, sections: t.sections, artifacts: t.artifacts, parts: t.parts, composition: t.composition }),
    } }, origin(t.id));
  }
  const atRoot = (id: string, kind: string, fields: Record<string, unknown>) =>
    add({ id, kind, parent: s.id, file: { id, kind, fields: compact(fields) } }, origin(id));
  for (const p of m.purposes) atRoot(p.id, "purpose", { statement: p.statement, intendedChange: p.intendedChange, successCriteria: p.successCriteria, nonGoals: p.nonGoals, constraints: p.constraints, source: p.source });
  for (const e of m.externals) atRoot(e.id, "external", { name: e.name, kind: e.kind, modeled: e.modeled, external: e.external, source: e.source });
  for (const c of m.claims) {
    atRoot(c.id, "claim", {
      name: c.name, purpose: c.purpose, mechanism: c.mechanism, outcome: c.outcome, indicator: c.indicator, evaluationMethod: c.evaluationMethod,
      limitation: c.limitation, activities: c.activities, kind: c.kind, status: c.status, deferred: c.deferred,
    });
  }
  for (const f of m.description?.features ?? []) atRoot(f.id, "feature", { name: f.name, summary: f.summary, deferred: f.deferred, source: f.source });
  for (const c of m.description?.commitments ?? []) atRoot(c.id, "commitment", { statement: c.statement, features: c.features, coupledWith: c.coupledWith, source: c.source });
  for (const n of m.nodes) {
    add({ id: n.id, kind: n.kind, parent: n.parent ?? s.id, file: {
      id: n.id, kind: n.kind, fields: ontologyFields(n), ...(n.provisional && { provisional: true }),
    } }, origin(n.id));
  }
  for (const r of m.requirements) {
    add({ id: r.id, kind: "requirement", parent: r.subjects[0] ?? r.thing, file: {
      id: r.id, kind: "requirement", fields: compact({ thing: r.thing, title: r.title, text: r.text, enabled: r.enabled, source: r.source }),
    } }, origin(r.id));
  }
  for (const j of m.journeys) {
    add({ id: j.id, kind: "journey", parent: journeyOwner(m, j), file: {
      id: j.id, kind: "journey",
      fields: compact({ name: j.name, actorGoal: j.actorGoal, features: j.features, requirements: j.requirements, start: j.start, deferred: j.deferred, segments: j.segments }),
    } }, origin(j.id));
    for (const st of j.steps) {
      const id = `${j.id}/${st.id}`;
      const refs = { screen: st.screen, operation: st.operation, external: st.external };
      add({ id, kind: "step", parent: j.id, slug: slugOf(st.id), file: {
        id, kind: "step",
        fields: compact({
          step: st.id, actor: st.actor, action: st.action, state: st.state, kind: st.kind, unresolved: st.unresolved,
          requirementRefs: st.requirementRefs, next: st.next, ...(st.unresolved && refs),
        }),
      } }, origin(j.id));
    }
  }

  // Links, once every node exists, so an inbound cross link can land on its other end.
  for (const p of m.purposes) for (const to of p.beneficiaries) linkOut(p.id, { rel: "beneficiary", to }, origin(p.id));
  for (const c of m.claims) for (const to of c.beneficiaries) linkOut(c.id, { rel: "beneficiary", to }, origin(c.id));
  for (const e of m.externals) for (const l of e.links) cross(e.id, l, origin(e.id));
  for (const n of m.nodes) {
    for (const to of n.refines) linkOut(n.id, { rel: "refines", to }, origin(n.id));
    for (const l of n.links) cross(n.id, l, origin(n.id));
  }
  for (const r of m.requirements) {
    for (const to of r.subjects) linkOut(r.id, { rel: "subject", to }, origin(r.id));
    for (const to of r.refines) linkOut(r.id, { rel: "refines", to }, origin(r.id));
  }
  for (const j of m.journeys) {
    for (const st of j.steps) {
      if (st.unresolved) continue;
      const id = `${j.id}/${st.id}`;
      if (st.screen) linkOut(id, { rel: "stepScreen", to: st.screen }, origin(j.id));
      if (st.operation) linkOut(id, { rel: "stepOperation", to: st.operation }, origin(j.id));
      if (st.external) linkOut(id, { rel: "stepExternal", to: st.external }, origin(j.id));
    }
  }

  for (const d of drafts.values()) {
    if (d.parent !== undefined && !drafts.has(d.parent)) issues.push({ path: origin(d.id), message: `${d.id} has parent ${d.parent}, which is not a node` });
  }
  const ownerOf = (id: string): Draft | undefined => {
    for (let d = drafts.get(id); d; d = d.parent === undefined ? undefined : drafts.get(d.parent)) {
      if (d.file.template !== undefined || d.kind === "thing" || d.kind === "system") return d;
    }
    return undefined;
  };

  // Criteria go on their subject; each hook is written inline under the first criterion that names it.
  const hooks = new Map(m.hooks.map((h) => [h.id, h]));
  const placed = new Set<string>();
  for (const c of m.criteria) {
    const subject = drafts.get(c.subjectId);
    if (!subject) { issues.push({ path: origin(c.id), message: `criterion ${c.id} has subject ${c.subjectId}, which is not a node` }); continue; }
    const owner = ownerOf(c.subjectId);
    if (owner?.id !== c.ownerId) issues.push({ path: origin(c.id), message: `criterion ${c.id} is owned by ${c.ownerId}, but the nearest Thing or System above ${c.subjectId} is ${owner?.id}` });
    const inline = c.hooks.map((id): string | NodeHook => {
      const h = hooks.get(id);
      if (!h) { issues.push({ path: origin(c.id), message: `criterion ${c.id} names hook ${id}, which is not declared` }); return id; }
      if (!h.criteria.includes(c.id)) issues.push({ path: origin(id), message: `hook ${id} does not list criterion ${c.id}, which names it` });
      if (placed.has(id)) return id;
      placed.add(id);
      return compact({
        id, version: h.version === 1 ? undefined : h.version, assay: h.assay, tier: h.tier, engine: h.engine,
        target: h.targetKind === c.targetKind ? undefined : h.targetKind, triggers: h.triggers, inputs: h.inputs,
        verdictMapping: h.verdictMapping, timeoutMs: h.timeoutMs === 60000 ? undefined : h.timeoutMs,
        costTier: h.costTier === "free" ? undefined : h.costTier, binding: h.binding === "defined" ? undefined : h.binding, fromTemplate: h.fromTemplate,
      }) as NodeHook;
    });
    const criterion = compact({
      id: c.id, version: c.version === 1 ? undefined : c.version, title: c.title, claim: c.claim,
      severity: c.severity === "hard" ? undefined : c.severity, target: c.targetKind === "model" ? undefined : c.targetKind, gates: c.gates,
      applicableWhen: c.applicableWhen, deferred: c.deferred || undefined, refines: c.refines, satisfies: c.satisfies,
      sourceRefs: c.sourceRefs, hooks: inline, fromTemplate: c.fromTemplate,
    }) as NodeCriterion;
    (subject.file.criteria ??= []).push(criterion);
  }
  for (const h of m.hooks) {
    if (!placed.has(h.id)) issues.push({ path: origin(h.id), message: `hook ${h.id} is named by no criterion, so it has nowhere to go` });
    for (const c of h.criteria) if (!m.criteria.some((x) => x.id === c && x.hooks.includes(h.id))) issues.push({ path: origin(h.id), message: `hook ${h.id} lists criterion ${c}, which does not name it` });
  }
  if (issues.length) throw new GenomeTreeError(issues);

  // Directories: the root is "", every other node a slug under its parent's, unique among its siblings.
  const dirs = new Map<string, string>([[s.id, ""]]);
  const used = new Set<string>([EVOLUTIONS_DIR]);
  const dirOf = (d: Draft): string => {
    const known = dirs.get(d.id);
    if (known !== undefined) return known;
    const base = dirOf(drafts.get(d.parent!)!);
    let dir = base ? `${base}/${d.slug}` : d.slug;
    for (let n = 2; used.has(dir); n++) dir = `${base ? `${base}/` : ""}${d.slug}-${n}`;
    used.add(dir);
    dirs.set(d.id, dir);
    return dir;
  };
  const out: [string, string][] = [];
  for (const d of drafts.values()) {
    const dir = dirOf(d);
    out.push([dir ? `${dir}/${NODE_FILE}` : NODE_FILE, formatNodeFile(d.file)]);
  }
  for (const [path, text] of entriesOf(files)) if (/^evolutions\/[^/]+\.ya?ml$/.test(path)) out.push([path, text]);
  return new Map(out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A journey's owner: the one Thing its steps' screens and operations belong to, else the System. */
function journeyOwner(m: SystemModel, j: schema.Journey): string {
  const owning = new Map(m.nodes.map((n) => [n.id, n.owningThing]));
  const things = new Set(j.steps.flatMap((st) => [st.screen, st.operation]).filter((x): x is string => !!x).map((id) => owning.get(id)));
  const [only] = things;
  return things.size === 1 && only ? only : m.system.id;
}
