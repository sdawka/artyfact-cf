import type {
  AssayHook, Certainty, Criterion, Journey, ModelJson, Relation, Requirement, UiBundle,
} from "./types";

/** The model's own object shapes. Every other template kind is a plain `node`, shown through its view hints. */
export const ENTRY_TYPES = [
  "system", "thing", "node", "external", "purpose", "claim", "feature", "commitment",
  "requirement", "criterion", "hook", "journey", "step", "evolution",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** One focusable object. `item` is the raw model object (OntologyNode, Criterion, Journey, ...). */
export interface IndexEntry<T = unknown> {
  id: string;
  type: EntryType;
  kind: string;
  name: string;
  item: T;
}

/** A cross-link with `direction` normalised: always `from` → `to`. */
export interface LinkRef {
  from: string;
  rel: Relation;
  to: string;
  certainty: Certainty;
  label?: string;
}

export type LinkDirection = "out" | "in" | "both";

export interface ModelIndex {
  model: ModelJson;
  entries: IndexEntry[];
  byId(id: string): IndexEntry | undefined;
  /** Containment children in declared order (journeys contain their steps). */
  children(id: string): IndexEntry[];
  parent(id: string): IndexEntry | undefined;
  /** Children of the parent, including `id` itself; `[]` for roots and non-containment objects. */
  siblings(id: string): IndexEntry[];
  /** `id` and every containment descendant, depth-first. */
  descendants(id: string): string[];
  crossLinks(id: string, dir?: LinkDirection): LinkRef[];
  /** Criteria whose `subjectId` is `id`. */
  criteriaFor(id: string): Criterion[];
  /** Criteria whose `ownerId` is `id`. */
  criteriaOwnedBy(id: string): Criterion[];
  hooksFor(criterionId: string): AssayHook[];
  journeysFor(id: string): Journey[];
  requirementsFor(id: string): Requirement[];
  /** Containment path from the System root to `id` inclusive; `[entry]` for non-containment objects; `[]` if unknown. */
  path(id: string): IndexEntry[];
}

/**
 * Journey steps are indexed under `<journeyId>/<stepId>` (step ids repeat across journeys). Same
 * format as `@artyfact/model`'s `stepKey`, so rule findings about steps resolve here.
 */
export const stepId = (journeyId: string, step: string) => `${journeyId}/${step}`;

const push = (r: Map<string, string[]>, k: string, v: string) => {
  const xs = r.get(k);
  if (!xs) r.set(k, [v]);
  else if (!xs.includes(v)) xs.push(v);
};

/** Builds O(1) lookup maps over a bundle (or a bare model). Pure; call once per bundle. Missing lists are treated as empty. */
export function buildIndex(source: UiBundle | ModelJson): ModelIndex {
  const model: ModelJson = "model" in source ? source.model : source;
  const claims = model.claims ?? [];
  const things = model.things ?? [];
  const nodes = model.nodes ?? [];
  const externals = model.externals ?? [];
  const criteria = model.criteria ?? [];
  const hooks = model.hooks ?? [];
  const journeys = model.journeys ?? [];
  const requirements = model.requirements ?? [];

  const entries: IndexEntry[] = [];
  const byIdMap = new Map<string, IndexEntry>();
  const add = (id: string, type: EntryType, kind: string, name: string, item: unknown) => {
    const e: IndexEntry = { id, type, kind, name, item };
    if (!byIdMap.has(id)) entries.push(e);
    byIdMap.set(id, e);
  };
  add(model.system.id, "system", "system", model.system.name, model.system);
  for (const t of things) add(t.id, "thing", "thing", t.name, t);
  for (const n of nodes) add(n.id, "node", n.kind, n.name, n);
  for (const e of externals) add(e.id, "external", "external", e.name, e);
  for (const p of model.purposes ?? []) add(p.id, "purpose", "purpose", p.statement, p);
  for (const c of claims) add(c.id, "claim", "claim", c.name, c);
  for (const f of model.description?.features ?? []) add(f.id, "feature", "feature", f.name, f);
  for (const c of model.description?.commitments ?? []) add(c.id, "commitment", "commitment", c.statement, c);
  for (const r of requirements) add(r.id, "requirement", "requirement", r.title, r);
  for (const c of criteria) add(c.id, "criterion", "criterion", c.title, c);
  for (const h of hooks) add(h.id, "hook", "hook", h.assay, h);
  for (const j of journeys) {
    add(j.id, "journey", "journey", j.name, j);
    for (const s of j.steps) add(stepId(j.id, s.id), "step", "step", s.action, s);
  }
  for (const e of model.evolutions ?? []) add(e.id, "evolution", "evolution", e.title, e);

  const parentOf = new Map<string, string>();
  const childIds = new Map<string, string[]>();
  const contain = (parent: string, child: string) => {
    parentOf.set(child, parent);
    push(childIds, parent, child);
  };
  for (const t of things) contain(model.system.id, t.id);
  for (const n of nodes) if (n.parent) contain(n.parent, n.id);
  // Purposes, claims, features, commitments and journeys are Genome tree nodes too: under the node whose directory
  // holds their `node.yaml` (v2 `origin`), else under the System (v1 files).
  const origin = (model as { origin?: Record<string, string> }).origin ?? {};
  const holder = (id: string) => {
    const dirs = (origin[id] ?? "").split("/").slice(0, -2);
    for (let i = dirs.length - 1; i >= 0; i--) if (byIdMap.has(dirs[i]!)) return dirs[i]!;
    return model.system.id;
  };
  const rooted = [
    ...(model.purposes ?? []), ...claims, ...(model.description?.features ?? []), ...(model.description?.commitments ?? []), ...journeys,
  ];
  for (const { id } of rooted) contain(holder(id), id);
  for (const j of journeys) for (const s of j.steps) contain(j.id, stepId(j.id, s.id));

  const linksOut = new Map<string, LinkRef[]>();
  const linksIn = new Map<string, LinkRef[]>();
  for (const { id, links } of [...nodes, ...externals]) {
    for (const l of links ?? []) {
      const [from, to] = l.direction === "in" ? [l.to, id] : [id, l.to];
      const ref: LinkRef = { from, rel: l.rel, to, certainty: l.certainty ?? "declared", ...(l.label !== undefined && { label: l.label }) };
      (linksOut.get(from) ?? linksOut.set(from, []).get(from)!).push(ref);
      (linksIn.get(to) ?? linksIn.set(to, []).get(to)!).push(ref);
    }
  }

  const criteriaBySubject = new Map<string, string[]>();
  const criteriaByOwner = new Map<string, string[]>();
  const hooksByCriterion = new Map<string, string[]>();
  const hookIds = new Set(hooks.map((h) => h.id));
  for (const c of criteria) {
    push(criteriaBySubject, c.subjectId, c.id);
    push(criteriaByOwner, c.ownerId, c.id);
    for (const h of c.hooks ?? []) if (hookIds.has(h)) push(hooksByCriterion, c.id, h);
  }
  for (const h of hooks) for (const c of h.criteria) push(hooksByCriterion, c, h.id);

  const journeysByNode = new Map<string, string[]>();
  for (const j of journeys) {
    for (const s of j.steps) {
      for (const ref of [s.screen, s.operation, s.external, ...(s.requirementRefs ?? [])]) if (ref) push(journeysByNode, ref, j.id);
    }
    for (const ref of [...j.requirements, ...j.features]) push(journeysByNode, ref, j.id);
  }
  const requirementsByNode = new Map<string, string[]>();
  for (const r of requirements) for (const s of r.subjects ?? []) push(requirementsByNode, s, r.id);

  const byId = (id: string) => byIdMap.get(id);
  const resolve = <T>(ids: string[] | undefined) =>
    (ids ?? []).map((i) => byIdMap.get(i)).filter((e): e is IndexEntry => e !== undefined) as IndexEntry<T>[];
  const items = <T>(ids: string[] | undefined) => resolve<T>(ids).map((e) => e.item);
  const children = (id: string) => resolve(childIds.get(id));
  const parent = (id: string) => {
    const p = parentOf.get(id);
    return p === undefined ? undefined : byIdMap.get(p);
  };

  return {
    model,
    entries,
    byId,
    children,
    parent,
    siblings: (id) => {
      const p = parentOf.get(id);
      return p === undefined ? [] : children(p);
    },
    descendants: (id) => {
      const out: string[] = [];
      const seen = new Set<string>();
      const walk = (x: string) => {
        if (seen.has(x)) return;
        seen.add(x);
        out.push(x);
        for (const c of childIds.get(x) ?? []) walk(c);
      };
      if (byIdMap.has(id)) walk(id);
      return out;
    },
    crossLinks: (id, dir = "both") => [
      ...(dir === "in" ? [] : (linksOut.get(id) ?? [])),
      ...(dir === "out" ? [] : (linksIn.get(id) ?? [])),
    ],
    criteriaFor: (id) => items<Criterion>(criteriaBySubject.get(id)),
    criteriaOwnedBy: (id) => items<Criterion>(criteriaByOwner.get(id)),
    hooksFor: (cid) => items<AssayHook>(hooksByCriterion.get(cid)),
    journeysFor: (id) => items<Journey>(journeysByNode.get(id)),
    requirementsFor: (id) => items<Requirement>(requirementsByNode.get(id)),
    path: (id) => {
      const e = byIdMap.get(id);
      if (!e) return [];
      const out = [e];
      const seen = new Set([id]);
      for (let p = parentOf.get(id); p !== undefined && !seen.has(p); p = parentOf.get(p)) {
        const pe = byIdMap.get(p);
        if (!pe) break;
        out.unshift(pe);
        seen.add(p);
      }
      return out;
    },
  };
}
