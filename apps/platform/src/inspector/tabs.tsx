import type { ReactNode } from "react";
import { useEvaluations, useRealizationsTouching } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import type { IndexEntry, LinkRef } from "@/model/index";
import { verdictOf } from "@/model/status";
import type { Criterion, Requirement, Source, TheoryClaim } from "@/model/types";
import { useModel } from "@/model/useModel";
import { BodyFor } from "./bodies";
import styles from "./Inspector.module.css";

export const INSPECTOR_TABS = [
  { id: "what", label: "What" },
  { id: "why", label: "Why" },
  { id: "dependencies", label: "Dependencies" },
  { id: "changes", label: "Changes" },
  { id: "rules", label: "Rules & claims" },
  { id: "evidence", label: "Evidence" },
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number]["id"];

type TabProps = { entry: IndexEntry };
const field = <T,>(entry: IndexEntry, key: string) => (entry.item as Record<string, unknown> | null)?.[key] as T | undefined;

function Chips({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return <span className={styles.muted}>none</span>;
  return (
    <ul className={styles.chips}>
      {ids.map((id) => (
        <li key={id}><NodeChip id={id} size="sm" /></li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

export function WhatTab({ entry }: TabProps) {
  return <BodyFor entry={entry} />;
}

/** Sources, the GD → S → C refinement chain, Purpose/Theory and commitment bundles. */
export function WhyTab({ entry }: TabProps) {
  const m = useModel();
  const id = entry.id;
  const source = field<Source>(entry, "source");
  const refines = field<string[]>(entry, "refines") ?? [];

  const reqs: Requirement[] = entry.type === "requirement" ? [entry.item as Requirement] : m.requirementsFor(id);
  const features = new Set<string>(reqs.flatMap((r) => r.refines ?? []));
  if (entry.type === "feature") features.add(id);
  const reqIds = new Set(reqs.map((r) => r.id));
  const criteria = [
    ...m.criteriaFor(id),
    ...(m.index.model.criteria ?? []).filter((c) => (c.sourceRefs ?? []).some((s) => reqIds.has(s))),
  ].filter((c, i, xs) => xs.findIndex((x) => x.id === c.id) === i);

  const claims: TheoryClaim[] = (m.index.model.claims ?? m.index.model.theory ?? []).filter((c) => (c.activities ?? []).includes(id));
  const purposes = new Set<string>(claims.map((c) => c.purpose));
  const commitments = (m.index.model.description?.commitments ?? []).filter((c) => c.features.some((f) => features.has(f)));
  const crit = entry.type === "criterion" ? (entry.item as Criterion) : undefined;

  return (
    <div className={styles.stack}>
      <Row label="Source">
        {source ? (
          <>
            <span>{source.doc}{source.section ? ` §${source.section}` : ""}</span>
            {source.quote && <blockquote className={styles.quote}>{source.quote}</blockquote>}
          </>
        ) : (
          <span className={styles.muted}>unknown</span>
        )}
      </Row>
      {refines.length > 0 && <Row label="Refines"><Chips ids={refines} /></Row>}
      {crit && (
        <>
          <Row label="Source refs"><Chips ids={crit.sourceRefs ?? []} /></Row>
          <Row label="Satisfies"><Chips ids={crit.satisfies ?? []} /></Row>
        </>
      )}
      <Row label="Features (GD)"><Chips ids={[...features]} /></Row>
      <Row label="Requirements (S)"><Chips ids={[...reqIds]} /></Row>
      <Row label="Criteria (C)"><Chips ids={criteria.map((c) => c.id)} /></Row>
      <Row label="Theory"><Chips ids={claims.map((c) => c.id)} /></Row>
      <Row label="Purpose"><Chips ids={[...purposes]} /></Row>
      <Row label="Commitments"><Chips ids={commitments.map((c) => c.id)} /></Row>
    </div>
  );
}

/** Cross-links grouped by relation and direction; each end is clickable. */
export function DependenciesTab({ entry }: TabProps) {
  const m = useModel();
  const links = m.crossLinks(entry.id);
  const hooks = entry.type === "criterion" ? m.hooksFor(entry.id).map((h) => h.id) : [];
  if (!links.length && !hooks.length) return <EmptyState title="No links from or to this object." />;
  const groups = new Map<string, LinkRef[]>();
  for (const l of links) {
    const key = l.from === entry.id ? `${l.rel} →` : `← ${l.rel}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return (
    <div className={styles.stack}>
      {[...groups].map(([key, ls]) => (
        <Row key={key} label={key}>
          <ul className={styles.chips}>
            {ls.map((l) => {
              const other = l.from === entry.id ? l.to : l.from;
              return (
                <li key={`${other}-${l.label ?? ""}`}>
                  <NodeChip id={other} size="sm" />
                  {l.certainty !== "declared" && <span className={styles.muted}> ({l.certainty})</span>}
                  {l.label && <span className={styles.muted}> {l.label}</span>}
                </li>
              );
            })}
          </ul>
        </Row>
      ))}
      {hooks.length > 0 && <Row label="Hooks"><Chips ids={hooks} /></Row>}
    </div>
  );
}

/**
 * Stub (owned by the Work/History slice): evolutions in the model that affect this object and
 * realizations of them from the live board (`useRealizationsTouching`).
 */
export function ChangesTab({ entry }: TabProps) {
  const m = useModel();
  const { data: realizations, isLoading } = useRealizationsTouching(entry.id);
  const evolutions = (m.index.model.evolutions ?? []).filter((e) => e.affectedNodes.includes(entry.id));
  if (!evolutions.length && !realizations.length) {
    return <EmptyState title={isLoading ? "Loading changes…" : "No evolutions touch this object."} />;
  }
  return (
    <div className={styles.stack}>
      <Row label="Evolutions"><Chips ids={evolutions.map((e) => e.id)} /></Row>
      <Row label="Realizations">
        {realizations.length ? (
          <ul className={styles.chips}>
            {realizations.map((r) => (
              <li key={r.id}><NodeChip id={r.id} kind="realization" label={`${r.id} · ${r.status}`} size="sm" interactive={false} /></li>
            ))}
          </ul>
        ) : (
          <span className={styles.muted}>none</span>
        )}
      </Row>
    </div>
  );
}

/** Criteria about this object (owner / subject / target on three lines), rule findings and claims. */
export function RulesTab({ entry }: TabProps) {
  const m = useModel();
  const { data: evaluations = [] } = useEvaluations();
  const criteria = [...m.criteriaFor(entry.id), ...m.criteriaOwnedBy(entry.id)].filter(
    (c, i, xs) => xs.findIndex((x) => x.id === c.id) === i,
  );
  const findings = m.bundle.readiness.modelReadiness.findings.filter((f) => f.subject === entry.id);
  const claims = (m.index.model.claims ?? m.index.model.theory ?? []).filter((c) => (c.activities ?? []).includes(entry.id));
  if (!criteria.length && !findings.length && !claims.length) {
    return <EmptyState title="No criteria, findings or claims reference this object." />;
  }
  return (
    <div className={styles.stack}>
      {criteria.map((c) => (
        <section key={c.id} className={styles.card}>
          <div className={styles.cardHead}>
            <NodeChip id={c.id} size="sm" />
            <VerdictBadge verdict={verdictOf(c.id, evaluations)} />
          </div>
          <div className={styles.lines}>
            <div><span className={styles.muted}>Owner</span> <NodeChip id={c.ownerId} size="sm" /></div>
            <div><span className={styles.muted}>Subject</span> <NodeChip id={c.subjectId} size="sm" /></div>
            <div><span className={styles.muted}>Target</span> {c.targetKind} · gates {c.gates.join(", ") || "none"}</div>
          </div>
        </section>
      ))}
      {findings.length > 0 && (
        <Row label="Findings">
          <ul className={styles.plain}>
            {findings.map((f, i) => (
              <li key={`${f.ruleId}-${i}`}>
                <code>{f.ruleId}</code> {f.severity}: {f.message}
              </li>
            ))}
          </ul>
        </Row>
      )}
      {claims.length > 0 && <Row label="Claims"><Chips ids={claims.map((c) => c.id)} /></Row>}
    </div>
  );
}

/**
 * Stub (owned by the Evaluations slice): current verdict per criterion on this object, from
 * `useEvaluations()`. Raw evidence links arrive with that slice.
 */
export function EvidenceTab({ entry }: TabProps) {
  const m = useModel();
  const { data: evaluations = [] } = useEvaluations();
  const criteria = m.criteriaFor(entry.id);
  if (!criteria.length) return <EmptyState title="No criteria have this object as their subject." />;
  return (
    <ul className={styles.plain}>
      {criteria.map((c) => (
        <li key={c.id} className={styles.cardHead}>
          <NodeChip id={c.id} size="sm" />
          <VerdictBadge verdict={verdictOf(c.id, evaluations)} />
          <span className={styles.muted}>{evaluations.filter((e) => e.criterion === c.id).length} evaluations</span>
        </li>
      ))}
    </ul>
  );
}

export const TAB_COMPONENTS: Record<InspectorTab, (p: TabProps) => ReactNode> = {
  what: WhatTab,
  why: WhyTab,
  dependencies: DependenciesTab,
  changes: ChangesTab,
  rules: RulesTab,
  evidence: EvidenceTab,
};
