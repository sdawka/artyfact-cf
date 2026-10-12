import type * as schema from "./schema";
import type { SystemModel } from "./load";

export type EntryType =
  | "system" | "thing" | "node" | "external" | "purpose" | "claim" | "feature" | "commitment"
  | "requirement" | "criterion" | "hook" | "journey" | "evolution";

export interface IndexEntry {
  id: string;
  type: EntryType;
  /** NodeKind for graph objects (system, thing, ontology nodes, externals, purposes, claims, requirements), else `type`. */
  kind: string;
  name: string;
  item: unknown;
}

/** A cross-link with `direction` normalised: always `from` → `to`. */
export interface LinkRef { from: string; rel: schema.Relation; to: string; certainty: schema.Certainty; label?: string }

export interface ModelIndex {
  byId: Record<string, IndexEntry>;
  /** Containment: system → things → top-level nodes → ...; ordered as declared (template objects first). */
  children: Record<string, string[]>;
  linksOut: Record<string, LinkRef[]>;
  linksIn: Record<string, LinkRef[]>;
  criteriaBySubject: Record<string, string[]>;
  criteriaByOwner: Record<string, string[]>;
  hooksByCriterion: Record<string, string[]>;
  /** Steps' screen/operation/external/requirementRefs plus the journey's requirements and features. */
  journeysByNode: Record<string, string[]>;
  requirementsByNode: Record<string, string[]>;
  /** Containment path from the System root to `id` inclusive; `[id]` for non-containment objects; `[]` if unknown. */
  path(id: string): string[];
  /** The nearest `section` node at or above `id`, if any. */
  layer(id: string): string | undefined;
}

type IndexInput = Omit<SystemModel, "index">;

const push = (r: Record<string, string[]>, k: string, v: string) => {
  const xs = (r[k] ??= []);
  if (!xs.includes(v)) xs.push(v);
};

export function index(m: IndexInput): ModelIndex {
  const byId: Record<string, IndexEntry> = {};
  const add = (id: string, type: EntryType, kind: string, name: string, item: unknown) => (byId[id] = { id, type, kind, name, item });
  add(m.system.id, "system", "system", m.system.name, m.system);
  for (const t of m.things) add(t.id, "thing", "thing", t.name, t);
  for (const n of m.nodes) add(n.id, "node", n.kind, n.name, n);
  for (const e of m.externals) add(e.id, "external", "external", e.name, e);
  for (const p of m.purposes) add(p.id, "purpose", "purpose", p.statement, p);
  for (const c of m.claims) add(c.id, "claim", "claim", c.name, c);
  for (const f of m.description?.features ?? []) add(f.id, "feature", "feature", f.name, f);
  for (const c of m.description?.commitments ?? []) add(c.id, "commitment", "commitment", c.statement, c);
  for (const r of m.requirements) add(r.id, "requirement", "requirement", r.title, r);
  for (const c of m.criteria) add(c.id, "criterion", "criterion", c.title, c);
  for (const h of m.hooks) add(h.id, "hook", "hook", h.assay, h);
  for (const j of m.journeys) add(j.id, "journey", "journey", j.name, j);
  for (const e of m.evolutions) add(e.id, "evolution", "evolution", e.title, e);

  const parentOf: Record<string, string> = {};
  for (const t of m.things) parentOf[t.id] = m.system.id;
  for (const n of m.nodes) if (n.parent) parentOf[n.id] = n.parent;
  const children: Record<string, string[]> = {};
  for (const t of m.things) push(children, m.system.id, t.id);
  for (const n of m.nodes) if (n.parent) push(children, n.parent, n.id);

  const linksOut: Record<string, LinkRef[]> = {};
  const linksIn: Record<string, LinkRef[]> = {};
  const owners: { id: string; links: schema.CrossLink[] }[] = [...m.nodes, ...m.externals];
  for (const { id, links } of owners) {
    for (const l of links) {
      const [from, to] = l.direction === "in" ? [l.to, id] : [id, l.to];
      const ref: LinkRef = { from, rel: l.rel, to, certainty: l.certainty, ...(l.label !== undefined && { label: l.label }) };
      (linksOut[from] ??= []).push(ref);
      (linksIn[to] ??= []).push(ref);
    }
  }

  const criteriaBySubject: Record<string, string[]> = {};
  const criteriaByOwner: Record<string, string[]> = {};
  const hooksByCriterion: Record<string, string[]> = {};
  const hookIds = new Set(m.hooks.map((h) => h.id));
  for (const c of m.criteria) {
    push(criteriaBySubject, c.subjectId, c.id);
    push(criteriaByOwner, c.ownerId, c.id);
    for (const h of c.hooks) if (hookIds.has(h)) push(hooksByCriterion, c.id, h);
  }
  for (const h of m.hooks) for (const c of h.criteria) push(hooksByCriterion, c, h.id);

  const journeysByNode: Record<string, string[]> = {};
  for (const j of m.journeys) {
    for (const s of j.steps) {
      for (const ref of [s.screen, s.operation, s.external, ...s.requirementRefs]) if (ref) push(journeysByNode, ref, j.id);
    }
    for (const ref of [...j.requirements, ...j.features]) push(journeysByNode, ref, j.id);
  }
  const requirementsByNode: Record<string, string[]> = {};
  for (const r of m.requirements) for (const s of r.subjects) push(requirementsByNode, s, r.id);

  const path = (id: string): string[] => {
    if (!byId[id]) return [];
    const out = [id];
    const seen = new Set(out);
    for (let p = parentOf[id]; p !== undefined && !seen.has(p); p = parentOf[p]) {
      out.unshift(p);
      seen.add(p);
    }
    return out;
  };
  const layer = (id: string) => path(id).reverse().find((x) => byId[x]?.type === "node" && byId[x].kind === "section");

  return { byId, children, linksOut, linksIn, criteriaBySubject, criteriaByOwner, hooksByCriterion, journeysByNode, requirementsByNode, path, layer };
}
