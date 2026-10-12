import { factSet, type FactSet, type Tuple } from "@artyfact/rules";
import type { SystemModel } from "./load";
import { templateRef } from "./load";

/** Every EDB relation toFacts() emits (docs: plan "packages/rules" — EDB relations). Always present, possibly empty. */
export const RELATIONS = [
  "node", "name", "parent", "link", "thing", "section", "requirement", "reqSubject", "refines", "criterion", "gate",
  "hook", "sourceRef", "satisfies", "purpose", "beneficiary", "external", "claim", "claimHas", "journey", "step",
  "stepScreen", "stepOp", "stepNext", "evolution", "affects", "acceptance", "templateRequires", "fromTemplate",
  "provisional", "effectText", "fieldType", "cardinality", "invariant", "policyConflict", "kitPinned", "kitRequired",
] as const;
export type RelationName = (typeof RELATIONS)[number];

const CLAIM_FIELDS = ["purpose", "mechanism", "beneficiaries", "activities", "outcome", "indicator", "evaluationMethod", "limitation"] as const;

export function toFacts(m: SystemModel): FactSet {
  const r = Object.fromEntries(RELATIONS.map((k) => [k, [] as Tuple[]])) as Record<RelationName, Tuple[]>;
  const emit = (rel: RelationName, ...t: Tuple) => r[rel].push(t);

  emit("node", m.system.id, "system", "");
  emit("name", m.system.id, m.system.name);
  for (const t of m.things) {
    emit("node", t.id, "thing", t.id);
    emit("name", t.id, t.name);
    emit("parent", t.id, m.system.id);
    emit("thing", t.id, t.templateRef ?? "");
    for (const s of t.sections) emit("section", t.id, s);
  }
  const kindOf = new Map(m.nodes.map((n) => [n.id, n.kind]));
  for (const n of m.nodes) {
    emit("node", n.id, n.kind, n.owningThing ?? "");
    emit("name", n.id, n.name);
    if (n.parent) emit("parent", n.id, n.parent);
    for (const x of n.refines) emit("refines", n.id, x);
    if (n.fromTemplate) emit("fromTemplate", n.id, n.fromTemplate);
    if (n.provisional) emit("provisional", n.id);
    for (const e of n.effects) emit("effectText", n.id, e);
    for (const f of n.fields) emit("fieldType", n.id, f.name, f.type);
    if (n.cardinality !== undefined) emit("cardinality", n.id, n.cardinality);
    for (const i of n.invariants) emit("invariant", n.id, i);
  }
  // Links, direction-normalised (shared with the index). Policy conflicts are declared as
  // `{rel: references, to: <policy>, label: conflicts}` on a policy node.
  for (const links of Object.values(m.index.linksOut)) {
    for (const l of links) {
      emit("link", l.from, l.rel, l.to, l.certainty);
      if (l.rel === "references" && l.label === "conflicts" && kindOf.get(l.from) === "policy") emit("policyConflict", l.from, l.to);
    }
  }
  for (const e of m.externals) {
    emit("node", e.id, "external", "");
    emit("name", e.id, e.name);
    emit("external", e.id, e.kind);
  }
  for (const p of m.purposes) {
    emit("node", p.id, "purpose", "");
    emit("purpose", p.id);
    for (const b of p.beneficiaries) emit("beneficiary", p.id, b);
  }
  for (const c of m.claims) {
    emit("node", c.id, "claim", "");
    emit("name", c.id, c.name);
    emit("claim", c.id, c.deferred);
    for (const f of CLAIM_FIELDS) if (c[f].length > 0) emit("claimHas", c.id, f);
  }
  for (const q of m.requirements) {
    emit("node", q.id, "requirement", q.thing);
    emit("name", q.id, q.title);
    emit("requirement", q.id, q.thing, q.enabled);
    for (const s of q.subjects) emit("reqSubject", q.id, s);
    for (const x of q.refines) emit("refines", q.id, x);
  }
  const hookById = new Map(m.hooks.map((h) => [h.id, h]));
  for (const c of m.criteria) {
    emit("name", c.id, c.title);
    emit("criterion", c.id, c.ownerKind, c.ownerId, c.subjectKind, c.subjectId, c.targetKind, c.severity, c.deferred);
    for (const g of c.gates) emit("gate", c.id, g);
    for (const s of c.sourceRefs) emit("sourceRef", c.id, s);
    for (const s of c.satisfies) emit("satisfies", c.id, s);
    for (const x of c.refines) emit("refines", c.id, x);
    if (c.fromTemplate) emit("fromTemplate", c.id, c.fromTemplate);
  }
  for (const [crit, hs] of Object.entries(m.index.hooksByCriterion)) {
    for (const id of hs) {
      const h = hookById.get(id)!;
      emit("hook", h.id, crit, h.engine, h.tier, h.binding);
    }
  }
  for (const h of m.hooks) if (h.fromTemplate) emit("fromTemplate", h.id, h.fromTemplate);
  for (const j of m.journeys) {
    emit("name", j.id, j.name);
    emit("journey", j.id, j.deferred);
    for (const s of j.steps) {
      emit("step", j.id, s.id, s.kind);
      if (s.screen) emit("stepScreen", j.id, s.id, s.screen);
      if (s.operation) emit("stepOp", j.id, s.id, s.operation);
      for (const n of s.next) emit("stepNext", j.id, s.id, n.to);
    }
  }
  for (const e of m.evolutions) {
    emit("name", e.id, e.title);
    emit("evolution", e.id, e.state, e.kind);
    for (const n of e.affectedNodes) emit("affects", e.id, n);
    for (const c of e.acceptanceCriteria) emit("acceptance", e.id, c);
  }
  for (const t of m.templates) for (const s of t.sections) emit("templateRequires", templateRef(t), s);
  for (const k of m.kits) {
    if (k.required) emit("kitRequired", k.id);
    if (k.version !== undefined) emit("kitPinned", k.id, k.version);
  }
  return factSet(r);
}
