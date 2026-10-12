import { factSet, type FactSet, type Tuple } from "@artyfact/rules";
import type { SystemModel } from "./load";
import { templateRef } from "./load";

/**
 * Every EDB relation toFacts() may emit — exactly docs/design/facts.md (the rule packs' `.decl` blocks).
 * Empty relations are omitted by factSet().
 */
export const RELATIONS = [
  "system", "thing", "thingArtifact", "thingSection", "node", "nodeName", "parent", "link", "ref", "known",
  "provisional", "effectText", "entityField", "cardinality", "policyMode", "hasActor", "hasEffects",
  "ext", "purpose", "purposeBeneficiary", "claim", "claimDeferred", "claimIndicator", "claimMethod", "claimBeneficiary",
  "requirementEnabled", "requirementSubject",
  "criterion", "criterionDeferred", "criterionSourceRef", "criterionHook", "hook",
  "journey", "journeyDeferred", "step", "stepEnd", "stepNext", "stepScreen", "stepOperation", "stepRef", "stepUnresolved",
  "evolution", "evolutionAcceptance", "evolutionAffects",
  "templateKnown", "templateRequires", "templateRequiresCriterion", "kitPinned", "kitRequired",
] as const;
export type RelationName = (typeof RELATIONS)[number];

/** Step ids are journey-local; `known`/`ref` use `<journey>/<step>`. */
export const stepKey = (journey: string, step: string) => `${journey}/${step}`;

export function toFacts(m: SystemModel): FactSet {
  const r = Object.fromEntries(RELATIONS.map((k) => [k, [] as Tuple[]])) as Record<RelationName, Tuple[]>;
  const emit = (rel: RelationName, ...t: Tuple) => r[rel].push(t);
  const known = (id: string) => emit("known", id);
  const ref = (from: string, via: string, tos: Iterable<string | undefined>) => {
    for (const to of tos) if (to) emit("ref", from, via, to);
  };

  emit("system", m.system.id);
  emit("node", m.system.id, "system", "");
  emit("nodeName", m.system.id, m.system.name.toLowerCase());
  known(m.system.id);
  for (const t of m.things) {
    emit("thing", t.id, t.templateRef ?? "");
    emit("node", t.id, "thing", t.id);
    emit("nodeName", t.id, t.name.toLowerCase());
    emit("parent", t.id, m.system.id);
    known(t.id);
    for (const a of t.artifacts) emit("thingArtifact", t.id, a.artifact);
    for (const s of t.sections) emit("thingSection", t.id, s);
  }
  for (const n of m.nodes) {
    emit("node", n.id, n.kind, n.owningThing ?? "");
    emit("nodeName", n.id, n.name.toLowerCase());
    known(n.id);
    if (n.parent) {
      emit("parent", n.id, n.parent);
      ref(n.id, "parent", [n.parent]);
    }
    ref(n.id, "refines", n.refines);
    if (n.provisional) emit("provisional", n.id);
    for (const e of n.effects) emit("effectText", n.id, e.toLowerCase());
    if (n.kind === "entity") for (const f of n.fields) emit("entityField", n.id, f.name, f.type);
    if (n.cardinality !== undefined) emit("cardinality", n.id, n.cardinality);
    if (n.kind === "policy" && n.mode !== undefined) emit("policyMode", n.id, n.mode);
    if (n.kind === "affordance" && n.actor) emit("hasActor", n.id);
    if (n.kind === "affordance" && n.effects.length) emit("hasEffects", n.id);
  }
  // Links in OUT orientation (the index has already swapped `direction: in`).
  for (const links of Object.values(m.index.linksOut)) {
    for (const l of links) {
      emit("link", l.from, l.rel, l.to, l.certainty);
      ref(l.from, "links", [l.to]);
    }
  }
  for (const e of m.externals) {
    emit("ext", e.id, e.kind);
    emit("node", e.id, "external", "");
    emit("nodeName", e.id, e.name.toLowerCase());
    known(e.id);
  }
  for (const p of m.purposes) {
    emit("purpose", p.id);
    known(p.id);
    for (const b of p.beneficiaries) emit("purposeBeneficiary", p.id, b);
    ref(p.id, "beneficiaries", p.beneficiaries);
  }
  for (const c of m.claims) {
    emit("claim", c.id);
    known(c.id);
    if (c.deferred) emit("claimDeferred", c.id);
    if (c.indicator.trim()) emit("claimIndicator", c.id);
    if (c.evaluationMethod.trim()) emit("claimMethod", c.id);
    for (const b of c.beneficiaries) emit("claimBeneficiary", c.id, b);
    ref(c.id, "beneficiaries", c.beneficiaries);
  }
  for (const f of m.description?.features ?? []) known(f.id);
  for (const c of m.description?.commitments ?? []) known(c.id);
  for (const q of m.requirements) {
    known(q.id);
    if (q.enabled) emit("requirementEnabled", q.id);
    for (const s of q.subjects) emit("requirementSubject", q.id, s);
    ref(q.id, "subjects", q.subjects);
    ref(q.id, "refines", q.refines);
  }
  for (const c of m.criteria) {
    known(c.id);
    emit("criterion", c.id, c.ownerKind, c.ownerId, c.subjectId, c.severity);
    if (c.deferred) emit("criterionDeferred", c.id);
    for (const s of c.sourceRefs) emit("criterionSourceRef", c.id, s);
    ref(c.id, "sourceRefs", c.sourceRefs);
    ref(c.id, "refines", c.refines);
  }
  for (const [crit, hs] of Object.entries(m.index.hooksByCriterion)) for (const h of hs) emit("criterionHook", crit, h);
  for (const h of m.hooks) {
    known(h.id);
    emit("hook", h.id, h.binding);
  }
  for (const j of m.journeys) {
    known(j.id);
    emit("journey", j.id, j.start);
    if (j.deferred) emit("journeyDeferred", j.id);
    for (const s of j.steps) {
      const key = stepKey(j.id, s.id);
      known(key);
      emit("step", j.id, s.id);
      if (s.kind === "end") emit("stepEnd", j.id, s.id);
      if (s.unresolved) emit("stepUnresolved", j.id, s.id);
      for (const n of s.next) emit("stepNext", j.id, s.id, n.to);
      if (s.screen) emit("stepScreen", j.id, s.id, s.screen);
      if (s.operation) emit("stepOperation", j.id, s.id, s.operation);
      for (const id of [s.screen, s.operation, s.external, ...s.requirementRefs]) if (id) emit("stepRef", j.id, s.id, id);
      // Unresolved steps are allowed to point at ids that do not exist yet (journey.stepRefMissing honours this too).
      if (!s.unresolved) {
        ref(key, "screen", [s.screen]);
        ref(key, "operation", [s.operation]);
        ref(key, "external", [s.external]);
      }
    }
  }
  for (const e of m.evolutions) {
    known(e.id);
    emit("evolution", e.id, e.state);
    for (const c of e.acceptanceCriteria) emit("evolutionAcceptance", e.id, c);
    for (const n of e.affectedNodes) emit("evolutionAffects", e.id, n);
    ref(e.id, "acceptanceCriteria", e.acceptanceCriteria);
  }
  for (const t of m.templates) {
    const tr = templateRef(t);
    emit("templateKnown", tr);
    known(tr);
    for (const s of t.sections) emit("templateRequires", tr, s);
    for (const c of t.criteria) emit("templateRequiresCriterion", tr, c.id);
  }
  for (const k of m.kits.kits) {
    emit("kitPinned", k.id, k.version);
    known(k.id);
  }
  for (const k of m.kits.required) emit("kitRequired", k);
  return factSet(r);
}
