import { useId, useState } from "react";
import type { Finding } from "@artyfact/model";
import { useReadiness } from "@/api/queries";
import { Derivation, type DerivationTree } from "@/components/Derivation/Derivation";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { NodeLink } from "../NodeLink";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { RowList, Row } from "@/components/RowList/RowList";
import { StatusText } from "@/components/StatusText/StatusText";
import { Button } from "@/components/ui";
import { verdictTone, type UiVerdict } from "@/model/status";
import type { IndexEntry } from "@/model/index";
import type { Criterion } from "@/model/types";
import { useModel } from "@/model/useModel";
import styles from "./RulesTab.module.css";

/** Derived relations that read as obligations on a node; `ancestor` and other plumbing stay hidden. */
export const OBLIGATION_RELATIONS = ["governedBy", "mutating", "outgoingDirect"] as const;

const PHRASE: Record<(typeof OBLIGATION_RELATIONS)[number], string> = {
  governedBy: "is governed by",
  mutating: "mutates state",
  outgoingDirect: "sends to another person",
};

type Derived = Record<string, readonly (readonly (string | number | boolean)[])[]>;

interface Scoped { criterion: Criterion; via?: { id: string; why: string } }

function ExplainButton({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls: string; label: string }) {
  return (
    <Button variant="ghost" size="compact" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? "Hide" : "Explain"}<span className="sr-only"> {label}</span>
    </Button>
  );
}

function FindingItem({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={styles.item}>
      <div className={styles.head}><code>{f.rule}</code> <span className={styles.muted}>{f.level}</span></div>
      <p className={styles.text}>{f.message}</p>
      <ExplainButton open={open} onToggle={() => setOpen((o) => !o)} controls={id} label={`finding ${f.rule}`} />
      {open && <div id={id} className={styles.deriv}><Derivation finding={f} /></div>}
    </li>
  );
}

function ObligationItem({ relation, tuple, subject }: { relation: string; tuple: readonly (string | number | boolean)[]; subject: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const phrase = PHRASE[relation as keyof typeof PHRASE];
  const others = tuple.map(String).filter((a, i) => !(i === 0 && a === subject));
  // The bundle carries derived tuples, not their proofs, so the tree is the tuple alone.
  const tree: DerivationTree = { relation, tuple: [...tuple], edb: false, children: [] };
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        <code>{relation}</code>
        <span>{tuple[0] === subject ? phrase : `${phrase} (as object)`}</span>
        {others.map((o) => <NodeChip key={o} id={o} size="sm" />)}
      </div>
      <ExplainButton open={open} onToggle={() => setOpen((o) => !o)} controls={id} label={`${relation} ${tuple.join(" ")}`} />
      {open && (
        <div id={id} className={styles.deriv}>
          <Derivation derivation={tree} />
          <p className={styles.muted}>The rule chain for derived relations is not in the readiness report yet.</p>
        </div>
      )}
    </li>
  );
}

const VERDICT_GLYPH: Record<UiVerdict, string> = { pass: "✓", fail: "×", unknown: "?", stale: "↻", "not-run": "–", waived: "⊘" };

const INHERITED = "inherited from ancestor";

function CriterionRow({ s }: { s: Scoped }) {
  const m = useModel();
  const c = s.criterion;
  const verdict = m.verdictOf(c.id);
  const tone = verdictTone(verdict);
  const same = c.ownerId === c.subjectId;
  return (
    <Row
      title={<NodeLink id={c.id} />}
      status={<StatusText status={verdict} tone={tone === "subtle" ? "neutral" : tone} glyph={VERDICT_GLYPH[verdict]} />}
      meta={<MetaLine items={[
        { label: same ? "Owner and subject" : "Owner", value: <NodeLink id={c.ownerId} /> },
        ...(same ? [] : [{ label: "Subject", value: <NodeLink id={c.subjectId} /> }]),
        { label: "Target", value: `${c.targetKind}, gates ${c.gates.join(", ") || "none"}` },
        ...(s.via && s.via.why !== INHERITED ? [{ value: <>{s.via.why} <NodeLink id={s.via.id} /></> }] : []),
      ]} />}
    />
  );
}

/** Everything the Rules tab lists for a node, and the total the tab label counts. */
export function useRules(entry: IndexEntry) {
  const m = useModel();
  const { data } = useReadiness();
  const id = entry.id;

  const scoped = new Map<string, Scoped>();
  const add = (c: Criterion, via?: Scoped["via"]) => { if (!scoped.has(c.id)) scoped.set(c.id, { criterion: c, via }); };
  for (const c of m.criteriaFor(id)) add(c);
  for (const c of m.criteriaOwnedBy(id)) add(c);
  for (const a of m.path(id).slice(0, -1).reverse()) for (const c of m.criteriaFor(a.id)) add(c, { id: a.id, why: INHERITED });
  for (const l of m.crossLinks(id)) {
    if (l.rel !== "invokes") continue;
    const other = l.from === id ? l.to : l.from;
    for (const c of m.criteriaFor(other)) add(c, { id: other, why: l.from === id ? "on invoked" : "on caller" });
  }

  const report = (data ?? m.bundle.readiness) as { derived?: Derived };
  const derived = report.derived;
  const obligations = OBLIGATION_RELATIONS.flatMap((rel) =>
    (derived?.[rel] ?? []).filter((t) => t.some((a) => String(a) === id)).map((t) => ({ rel, t })),
  );
  const findings = m.bundle.readiness.modelReadiness.findings.filter((f) => f.subject === id);
  const claims = m.index.model.claims.filter((c) => c.activities.includes(id));
  return { scoped, derived, obligations, findings, claims, total: scoped.size + obligations.length + findings.length + claims.length };
}

/** Inspector "Rules": criteria in the node's lineage, derived obligations and findings, each with why. */
export function RulesTab({ entry }: { entry: IndexEntry }) {
  const id = entry.id;
  const { scoped, derived, obligations, findings, claims } = useRules(entry);

  const all = [...scoped.values()];
  const direct = all.filter((s) => s.via?.why !== INHERITED);
  const inherited = new Map<string, Scoped[]>();
  for (const s of all) if (s.via?.why === INHERITED) inherited.set(s.via.id, [...(inherited.get(s.via.id) ?? []), s]);
  if (derived && !scoped.size && !obligations.length && !findings.length && !claims.length) {
    return <EmptyState title="No criteria, derived obligations, findings or claims reference this object." />;
  }
  return (
    <div className={styles.stack}>
      {scoped.size > 0 && (
        <section aria-label="Criteria" className={styles.section}>
          <h3 className={styles.title}>Criteria</h3>
          {direct.length > 0 && <RowList label="Criteria" density="compact">{direct.map((s) => <CriterionRow key={s.criterion.id} s={s} />)}</RowList>}
          {[...inherited].map(([ancestor, rows]) => (
            <div key={ancestor} className={styles.section}>
              <h4 className={styles.subtitle}>Inherited from <NodeLink id={ancestor} /></h4>
              <RowList label={`Criteria inherited from ${ancestor}`} density="compact">{rows.map((s) => <CriterionRow key={s.criterion.id} s={s} />)}</RowList>
            </div>
          ))}
        </section>
      )}
      {!derived && (
        <section aria-label="Derived obligations" className={styles.section}>
          <h3 className={styles.title}>Derived obligations</h3>
          <p className={styles.text}>unknown</p>
          <p className={styles.muted}>The API did not supply derived relations, so obligations such as governed-by cannot be listed.</p>
        </section>
      )}
      {derived && obligations.length > 0 && (
        <section aria-label="Derived obligations" className={styles.section}>
          <h3 className={styles.title}>Derived obligations</h3>
          <ul className={styles.list}>
            {obligations.map(({ rel, t }) => <ObligationItem key={`${rel}-${t.join("|")}`} relation={rel} tuple={t} subject={id} />)}
          </ul>
        </section>
      )}
      {findings.length > 0 && (
        <section aria-label="Findings" className={styles.section}>
          <h3 className={styles.title}>Findings</h3>
          <ul className={styles.list}>{findings.map((f, i) => <FindingItem key={`${f.rule}-${i}`} f={f} />)}</ul>
        </section>
      )}
      {claims.length > 0 && (
        <section aria-label="Claims" className={styles.section}>
          <h3 className={styles.title}>Claims</h3>
          <ul className={styles.chips}>{claims.map((c) => <li key={c.id}><NodeChip id={c.id} size="sm" /></li>)}</ul>
        </section>
      )}
    </div>
  );
}
