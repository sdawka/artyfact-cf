import type { Graph, GraphLink, GraphNode } from "../../graph/graph.ts";
import { loadArtyfactModel, type ArtyfactModel, type LoadOptions } from "./load.ts";
import type * as schema from "./schema.ts";
import { templateRef, type Files } from "./templates.ts";

export const ARTYFACT_GENOME = "template.meta.artyfact-genome@1";

const isEmpty = (v: unknown) =>
  v === undefined || (Array.isArray(v) && !v.length) || (!!v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const compact = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => !isEmpty(v)));

/** A cross-link in out orientation: `direction: in` on `owner` becomes a link from the target to `owner`. */
export const crossLink = (owner: string, l: schema.CrossLink): GraphLink =>
  l.direction === "in" ? { from: l.to, rel: l.rel, to: owner, certainty: l.certainty } : { from: owner, rel: l.rel, to: l.to, certainty: l.certainty };

export const ontologyFields = (n: schema.OntologyNode) => compact({
  name: n.name, owningThing: n.owningThing, revision: n.revision, description: n.description, source: n.source,
  route: n.route, cardinality: n.cardinality, states: n.states, roles: n.roles, actor: n.actor, trigger: n.trigger,
  preconditions: n.preconditions, effects: n.effects, failure: n.failure, fields: n.fields, invariants: n.invariants,
  mode: n.mode, fromTemplate: n.fromTemplate,
});

export const criterionFields = (c: schema.Criterion) => compact({
  version: c.version, title: c.title, claim: c.claim, ownerKind: c.ownerKind, subjectKind: c.subjectKind, targetKind: c.targetKind,
  severity: c.severity, gates: c.gates, applicableWhen: c.applicableWhen, deferred: c.deferred, hooks: c.hooks, satisfies: c.satisfies,
  fromTemplate: c.fromTemplate,
});

export const criterionLinks = (c: schema.Criterion): GraphLink[] => [
  { from: c.id, rel: "owner", to: c.ownerId }, { from: c.id, rel: "subject", to: c.subjectId },
  ...c.sourceRefs.map((to) => ({ from: c.id, rel: "sourceRef", to })),
  ...c.refines.map((to) => ({ from: c.id, rel: "refines", to })),
];

export const hookFields = (h: schema.AssayHook) => compact({
  version: h.version, assay: h.assay, criteria: h.criteria, tier: h.tier, engine: h.engine, targetKind: h.targetKind,
  triggers: h.triggers, inputs: h.inputs, verdictMapping: h.verdictMapping, timeoutMs: h.timeoutMs, costTier: h.costTier,
  binding: h.binding, fromTemplate: h.fromTemplate,
});

export const templateFields = (t: schema.Template) => compact({
  kind: t.kind, version: t.version, name: t.name, description: t.description, sections: t.sections,
  criteria: t.criteria.map((c) => c.id), hooks: t.hooks.map((h) => h.id), requires: t.requires,
  scaffold: t.scaffold,
});

class Builder {
  nodes: GraphNode[] = [];
  links: GraphLink[] = [];
  private seenNodes = new Set<string>();
  private seenLinks = new Set<string>();
  node(id: string, kind: string, fields: Record<string, unknown>, parent?: string, provisional?: boolean) {
    const key = JSON.stringify([id, kind]);
    if (this.seenNodes.has(key)) return;
    this.seenNodes.add(key);
    this.nodes.push({ id, kind, ...(parent !== undefined && { parent }), fields, ...(provisional && { provisional: true }) });
  }
  link(l: GraphLink) {
    const key = JSON.stringify([l.from, l.rel, l.to]);
    if (this.seenLinks.has(key)) return;
    this.seenLinks.add(key);
    this.links.push(l.certainty === undefined ? { from: l.from, rel: l.rel, to: l.to } : l);
  }
  each(from: string, rel: string, tos: Iterable<string | undefined>) { for (const to of tos) if (to) this.link({ from, rel, to }); }
}

/** The canonical graph for a loaded artyfact model, under `template.meta.artyfact-genome@1`. */
export function artyfactGraph(m: ArtyfactModel): Graph {
  const b = new Builder();
  const s = m.system;
  b.node(s.id, "system", compact({
    name: s.name, profile: s.profile, phase: s.phase, head: s.head, purposes: s.purposes,
    rulePacks: m.kits.rulePacks.map((p) => `${p.id}@${p.version}`),
    narrative: m.description?.narrative, alternatives: m.description?.alternatives, openQuestions: m.description?.openQuestions,
  }));
  b.each(s.id, "pinned", [s.template ?? undefined]);
  for (const t of m.templates) b.node(templateRef(t), "template", templateFields(t));
  for (const k of m.kits.kits) { b.node(k.id, "kit", { version: k.version }); b.link({ from: s.id, rel: "pinned", to: k.id }); }
  for (const k of m.kits.required) { b.node(k, "kit", {}); b.link({ from: s.id, rel: "requires", to: k }); }

  for (const t of m.things) {
    b.node(t.id, "thing", compact({ name: t.name, description: t.description, purposeRefs: t.purposeRefs, sections: t.sections }), s.id);
    b.each(t.id, "pinned", [t.templateRef ?? undefined]);
    for (const a of t.artifacts) {
      b.node(a.artifact, "artifact", compact({ type: a.type, repo: a.repo, commit: a.commit, scope: a.scope }));
      b.link({ from: t.id, rel: "artifact", to: a.artifact });
    }
  }
  for (const n of m.nodes) {
    b.node(n.id, n.kind, ontologyFields(n), n.parent, n.provisional);
    b.each(n.id, "refines", n.refines);
    for (const l of n.links) b.link(crossLink(n.id, l));
  }
  for (const e of m.externals) {
    b.node(e.id, "external", compact({ name: e.name, kind: e.kind, modeled: e.modeled, external: e.external, source: e.source }));
    for (const l of e.links) b.link(crossLink(e.id, l));
  }
  for (const p of m.purposes) {
    b.node(p.id, "purpose", compact({ statement: p.statement, intendedChange: p.intendedChange, successCriteria: p.successCriteria, nonGoals: p.nonGoals, constraints: p.constraints, source: p.source }));
    b.each(p.id, "beneficiary", p.beneficiaries);
  }
  for (const c of m.claims) {
    b.node(c.id, "claim", compact({
      name: c.name, purpose: c.purpose, mechanism: c.mechanism, outcome: c.outcome, indicator: c.indicator, evaluationMethod: c.evaluationMethod,
      limitation: c.limitation, activities: c.activities, kind: c.kind, status: c.status, deferred: c.deferred,
    }));
    b.each(c.id, "beneficiary", c.beneficiaries);
  }
  for (const f of m.description?.features ?? []) b.node(f.id, "feature", compact({ name: f.name, summary: f.summary, deferred: f.deferred, source: f.source }));
  for (const c of m.description?.commitments ?? []) b.node(c.id, "commitment", compact({ statement: c.statement, features: c.features, coupledWith: c.coupledWith, source: c.source }));
  for (const q of m.requirements) {
    b.node(q.id, "requirement", compact({ thing: q.thing, title: q.title, text: q.text, enabled: q.enabled, source: q.source }));
    b.each(q.id, "subject", q.subjects);
    b.each(q.id, "refines", q.refines);
  }
  for (const c of m.criteria) { b.node(c.id, "criterion", criterionFields(c)); for (const l of criterionLinks(c)) b.link(l); }
  for (const h of m.hooks) b.node(h.id, "hook", hookFields(h));
  for (const j of m.journeys) {
    b.node(j.id, "journey", compact({ name: j.name, actorGoal: j.actorGoal, features: j.features, requirements: j.requirements, start: j.start, deferred: j.deferred, segments: j.segments }));
    for (const st of j.steps) {
      const key = `${j.id}/${st.id}`;
      const refs = { screen: st.screen, operation: st.operation, external: st.external };
      b.node(key, "step", compact({
        step: st.id, actor: st.actor, action: st.action, state: st.state, kind: st.kind, unresolved: st.unresolved,
        requirementRefs: st.requirementRefs, next: st.next, ...(st.unresolved && refs),
      }), j.id);
      if (!st.unresolved) {
        b.each(key, "stepScreen", [st.screen]);
        b.each(key, "stepOperation", [st.operation]);
        b.each(key, "stepExternal", [st.external]);
      }
      b.each(key, "stepNext", st.next.map((n) => `${j.id}/${n.to}`));
    }
  }
  for (const e of m.evolutions) {
    b.node(e.id, "evolution", compact({
      title: e.title, intent: e.intent, state: e.state, baseRevision: e.baseRevision, kind: e.kind, affectedClaims: e.affectedClaims,
      genomeDelta: e.genomeDelta, requiredEvidence: e.requiredEvidence, dependsOn: e.dependsOn, risk: e.risk, realizations: e.realizations, decision: e.decision,
    }));
    b.each(e.id, "acceptance", e.acceptanceCriteria);
    b.each(e.id, "affects", e.affectedNodes);
  }
  return { template: ARTYFACT_GENOME, nodes: b.nodes, links: b.links, declarations: [], evidence: [] };
}

/** Loads an artyfact YAML directory (path -> text) and emits the canonical graph. */
export const loadArtyfactSystem = (files: Files, opts: LoadOptions = {}): Graph => artyfactGraph(loadArtyfactModel(files, opts));
