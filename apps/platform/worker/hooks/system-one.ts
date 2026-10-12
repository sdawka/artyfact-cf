/**
 * `system-one` engine: System One judgments over a Genome candidate, mapped through `@artyfact/semantic` policy.
 * Thresholds live in the semantic package (`policy.verdict`, `reviewLevel`); nothing here re-derives them.
 *
 * DeltaReview.verdict always means "is this acceptable?": reviewDelta and purposeMeasures already use that sense;
 * topology's proposition verdict ("sends to several people") is inverted (confirmed → fail, ruled out → pass).
 * Provider off or failing → every judgment `unknown` with provenance.provider `off`/`error`; the judgments never throw.
 */
import type { SemanticDelta, SystemModel, Tuple } from "@artyfact/model";
import {
  band,
  purposeMeasures,
  reviewDelta,
  topology,
  type Level,
  type OntologyNode as S1Node,
  type Provenance,
  type SemanticChange,
  type SystemOne,
  type Verdict,
} from "@artyfact/semantic";
import type { DeltaReview } from "./contract";
import type { Outcome } from "./provenance";

const MULTI_RECIPIENT = "topology.multiRecipient";

const purposeOf = (m: SystemModel) => m.purposes.map((p) => p.statement).join(" ") || "(no purpose declared)";
const commitmentsOf = (m: SystemModel) => (m.description?.commitments ?? []).map((c) => ({ id: c.id, statement: c.statement }));

function governingFor(m: SystemModel, id: string) {
  const criteria = m.criteria
    .filter((c) => c.subjectId === id || c.sourceRefs.includes(id) || c.id === id)
    .map((c) => ({ id: c.id, title: c.title, claim: c.claim }));
  const reqIds = new Set(m.index.requirementsByNode[id] ?? []);
  const requirements = m.requirements.filter((r) => reqIds.has(r.id) || r.id === id).map((r) => ({ id: r.id, title: r.title, text: r.text }));
  return { criteria, requirements };
}

function changesOf(base: SystemModel, cand: SystemModel, delta: SemanticDelta): SemanticChange[] {
  const entry = (id: string) => cand.index.byId[id] ?? base.index.byId[id];
  const mk = (id: string, fieldsChanged: string[]): SemanticChange => ({
    id,
    kind: entry(id)?.kind ?? "unknown",
    before: base.index.byId[id]?.item ?? null,
    after: cand.index.byId[id]?.item ?? null,
    fieldsChanged,
  });
  return [
    ...delta.added.map((id) => mk(id, Object.keys((cand.index.byId[id]?.item as object) ?? {}))),
    ...delta.changed.map((c) => mk(c.id, c.fields)),
    ...delta.removed.map((id) => mk(id, [])),
  ];
}

function s1Node(m: SystemModel, id: string): S1Node | null {
  const e = m.index.byId[id];
  if (!e) return null;
  const item = e.item as { effects?: unknown; fields?: { name: string; type: string }[] };
  return {
    id,
    kind: e.kind,
    name: e.name,
    effects: item.effects ?? [],
    fields: Object.fromEntries((item.fields ?? []).map((f) => [f.name, f.type])),
  };
}

const levelOfBand = (p: number | null): Level => (p === null ? "info" : band(p) === "act" ? "error" : band(p) === "review" ? "warning" : "info");
const invert = (v: Verdict): Verdict => (v === "pass" ? "fail" : v === "fail" ? "pass" : "unknown");

/** reviewDelta per change, topology per touched semanticCandidate, purposeMeasures per touched claim. */
export async function reviewGenome(s1: SystemOne, base: SystemModel, cand: SystemModel, delta: SemanticDelta, derived: Record<string, Tuple[]>): Promise<DeltaReview[]> {
  const system = { id: base.system.id, purpose: purposeOf(base) };
  const commitments = commitmentsOf(base);
  const changes = changesOf(base, cand, delta);
  const touchedIds = new Set(changes.map((c) => c.id));

  const reviews = await Promise.all(
    changes.map(async (change): Promise<DeltaReview> => {
      const [r] = await reviewDelta(s1, { system, governing: governingFor(base, change.id) }, { changes: [change] }, commitments);
      return { subject: change.id, judgment: "reviewDelta", level: r.level, verdict: r.verdict, change, signals: r };
    }),
  );

  const topoNodes = [...new Set((derived.semanticCandidate ?? []).filter((t) => t[0] === MULTI_RECIPIENT && touchedIds.has(String(t[1]))).map((t) => String(t[1])))]
    .map((id) => s1Node(cand, id))
    .filter((n): n is S1Node => n !== null);
  const topo = (await topology(s1, topoNodes.map((node) => ({ node })))).map(
    (r): DeltaReview => ({ subject: r.nodeId, judgment: "topology", level: levelOfBand(r.multiRecipient), verdict: invert(r.verdict), signals: r }),
  );

  const claims = cand.claims.filter((c) => touchedIds.has(c.id) && !c.deferred);
  const purpose = (await purposeMeasures(s1, purposeOf(cand), claims)).map(
    (r): DeltaReview => ({ subject: r.claimId, judgment: "purposeMeasures", level: r.verdict === "fail" ? "warning" : "info", verdict: r.verdict, signals: r }),
  );

  return [...reviews, ...topo, ...purpose];
}

/** purposeMeasures over every non-deferred claim of `m` (hook binding for C.system.purpose). */
export async function judgePurpose(s1: SystemOne, m: SystemModel): Promise<DeltaReview[]> {
  const claims = m.claims.filter((c) => !c.deferred);
  return (await purposeMeasures(s1, purposeOf(m), claims)).map(
    (r): DeltaReview => ({ subject: r.claimId, judgment: "purposeMeasures", level: r.verdict === "fail" ? "warning" : "info", verdict: r.verdict, signals: r }),
  );
}

interface Judged {
  subject: string;
  verdict: Verdict;
  provenance: Provenance;
  level?: Level;
}

/**
 * Fold several judgments into one Evaluation outcome: any fail → fail; all pass → pass; otherwise unknown.
 * Nothing to judge is `unknown`, never a vacuous pass.
 */
export function aggregate(judged: Judged[], what: string): Outcome {
  const providers = [...new Set(judged.map((j) => j.provenance.provider))];
  const models = [...new Set(judged.map((j) => j.provenance.model))];
  const provenance = { provider: providers.join(",") || "none", model: models.join(",") || "none" };
  const observations = judged.map((j) => ({ subject: j.subject, verdict: j.verdict, level: j.level, provenance: j.provenance }));
  if (judged.length === 0) {
    return { execution: "completed", verdict: "unknown", observations: [], interpretation: `No ${what} inputs to judge.`, limitations: ["Nothing was sent to System One."], provenance };
  }
  const failed = judged.filter((j) => j.verdict === "fail");
  const allPass = judged.every((j) => j.verdict === "pass");
  const limitations = providers.some((p) => p === "off" || p === "error") ? ["System One was off or failed for some judgments; those are unknown."] : [];
  const errors = judged.filter((j) => j.provenance.error).map((j) => ({ subject: j.subject, error: j.provenance.error }));
  return {
    execution: "completed",
    verdict: failed.length ? "fail" : allPass ? "pass" : "unknown",
    observations: [...observations, ...(errors.length ? [{ providerErrors: errors }] : [])],
    interpretation: failed.length ? `${what}: ${failed.map((j) => j.subject).join(", ")} judged unacceptable.` : allPass ? `${what}: all ${judged.length} judged acceptable at ≥ 0.9.` : `${what}: some judgments are under threshold or unavailable.`,
    limitations,
    provenance,
  };
}

export const reviewsAsJudged = (rs: DeltaReview[]): Judged[] => rs.map((r) => ({ subject: r.subject, verdict: r.verdict, level: r.level, provenance: r.signals.provenance }));
