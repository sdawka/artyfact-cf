import type { SystemModel } from "./load";

export interface SemanticDelta {
  added: string[];
  removed: string[];
  changed: { id: string; fields: string[] }[];
  affectedCriteria: string[];
  affectedJourneys: string[];
}

const IGNORED = new Set(["revision"]);

/** Canonical JSON with sorted keys, so structural equality ignores key order. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Structural diff over every indexed object (ignoring `revision`). */
export function diffModels(a: SystemModel, b: SystemModel): SemanticDelta {
  const A = a.index.byId, B = b.index.byId;
  const added = sorted(Object.keys(B).filter((id) => !(id in A)));
  const removed = sorted(Object.keys(A).filter((id) => !(id in B)));
  const changed: SemanticDelta["changed"] = [];
  for (const id of sorted(Object.keys(A).filter((id) => id in B))) {
    const x = A[id].item as Record<string, unknown>, y = B[id].item as Record<string, unknown>;
    const fields = sorted([...Object.keys(x), ...Object.keys(y)]).filter((k) => !IGNORED.has(k) && canon(x[k]) !== canon(y[k]));
    if (fields.length) changed.push({ id, fields });
  }

  const touched = new Set([...added, ...removed, ...changed.map((c) => c.id)]);
  const sourceRefsChanged = new Set(changed.filter((c) => c.fields.includes("sourceRefs")).map((c) => c.id));
  const affectedCriteria = sorted(
    [...a.criteria, ...b.criteria]
      .filter((c) => touched.has(c.subjectId) || sourceRefsChanged.has(c.id) || c.sourceRefs.some((r) => touched.has(r)))
      .map((c) => c.id),
  );
  const ids = [...touched];
  const affectedJourneys = sorted([
    ...ids.flatMap((id) => [...(a.index.journeysByNode[id] ?? []), ...(b.index.journeysByNode[id] ?? [])]),
    ...ids.filter((id) => (A[id] ?? B[id]).type === "journey"),
  ]);
  return { added, removed, changed, affectedCriteria, affectedJourneys };
}

const touchedBy = (d: SemanticDelta) => new Set([...d.added, ...d.removed, ...d.changed.map((c) => c.id)]);

/**
 * Deterministic soft-conflict signal between two deltas against model `m`: ids both touch, and criteria/journeys
 * both reach (via their affected sets or via `m`'s index from the ids they touch).
 */
export function overlap(d1: SemanticDelta, d2: SemanticDelta, m: SystemModel): { shared: string[]; viaCriteria: string[]; viaJourneys: string[] } {
  const t1 = touchedBy(d1), t2 = touchedBy(d2);
  const reach = (d: SemanticDelta, t: Set<string>) => ({
    criteria: new Set([...d.affectedCriteria, ...[...t].flatMap((id) => m.index.criteriaBySubject[id] ?? [])]),
    journeys: new Set([...d.affectedJourneys, ...[...t].flatMap((id) => m.index.journeysByNode[id] ?? [])]),
  });
  const r1 = reach(d1, t1), r2 = reach(d2, t2);
  return {
    shared: sorted([...t1].filter((id) => t2.has(id))),
    viaCriteria: sorted([...r1.criteria].filter((c) => r2.criteria.has(c))),
    viaJourneys: sorted([...r1.journeys].filter((j) => r2.journeys.has(j))),
  };
}
