import type { ReactNode } from "react";
import { useRealizationsTouching } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import type { IndexEntry, LinkRef } from "@/model/index";
import type { Criterion, Requirement, Source, TheoryClaim } from "@/model/types";
import { useModel } from "@/model/useModel";
import { BodyFor } from "./bodies";
import { RulesTab, useRules } from "./bodies/RulesTab";
import { ChangesTab } from "./ChangesTab";
import { EvidenceTab } from "./EvidenceTab";
import styles from "./Inspector.module.css";

export const INSPECTOR_TABS = [
  { id: "what", label: "What" },
  { id: "why", label: "Why" },
  { id: "dependencies", label: "Links" },
  { id: "changes", label: "Changes" },
  { id: "rules", label: "Rules" },
  { id: "evidence", label: "Evidence" },
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number]["id"];

/** Inventory counts beside the tab labels, so the operator sees where content is before clicking. */
export function useTabCounts(entry: IndexEntry): Partial<Record<InspectorTab, number>> {
  const m = useModel();
  const { data: realizations } = useRealizationsTouching(entry.id);
  const rules = useRules(entry);
  const ids = new Set(m.descendants(entry.id));
  const links = m.crossLinks(entry.id).length + (entry.type === "criterion" ? m.hooksFor(entry.id).length : 0);
  const evolutions = (m.index.model.evolutions ?? []).filter((e) => e.affectedNodes.includes(entry.id)).length;
  return {
    dependencies: links,
    changes: evolutions + realizations.length,
    rules: rules.total,
    evidence: m.evaluations.filter((e) => ids.has(e.subjectId)).length,
  };
}

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

  const claims: TheoryClaim[] = m.index.model.claims.filter((c) => c.activities.includes(id));
  const purposes = new Set<string>(claims.map((c) => c.purpose));
  const commitments = (m.index.model.description?.commitments ?? []).filter((c) => c.features.some((f) => features.has(f)));
  const crit = entry.type === "criterion" ? (entry.item as Criterion) : undefined;

  const rows: [string, ReactNode][] = [];
  if (refines.length) rows.push(["Refines", <Chips ids={refines} />]);
  if (crit) {
    if (crit.sourceRefs?.length) rows.push(["Source refs", <Chips ids={crit.sourceRefs} />]);
    if (crit.satisfies?.length) rows.push(["Satisfies", <Chips ids={crit.satisfies} />]);
  }
  if (features.size) rows.push(["Features (GD)", <Chips ids={[...features]} />]);
  if (reqIds.size) rows.push(["Requirements (S)", <Chips ids={[...reqIds]} />]);
  if (criteria.length) rows.push(["Criteria (C)", <Chips ids={criteria.map((c) => c.id)} />]);
  if (claims.length) rows.push(["Theory", <Chips ids={claims.map((c) => c.id)} />]);
  if (purposes.size) rows.push(["Purpose", <Chips ids={[...purposes]} />]);
  if (commitments.length) rows.push(["Commitments", <Chips ids={commitments.map((c) => c.id)} />]);
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
      {rows.map(([label, node]) => <Row key={label} label={label}>{node}</Row>)}
      {!rows.length && <p className={styles.note}>No features, requirements, criteria, Theory, Purpose or commitments refer to this.</p>}
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
                  {l.certainty !== "declared" && <span className={styles.muted}> {l.certainty}</span>}
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

export { ChangesTab, EvidenceTab, RulesTab };

export const TAB_COMPONENTS: Record<InspectorTab, (p: TabProps) => ReactNode> = {
  what: WhatTab,
  why: WhyTab,
  dependencies: DependenciesTab,
  changes: ChangesTab,
  rules: RulesTab,
  evidence: EvidenceTab,
};
