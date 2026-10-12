import { useId, useState } from "react";
import type { Finding } from "@artyfact/model";
import { useReadiness } from "@/api/queries";
import { Derivation, type DerivationTree } from "@/components/Derivation/Derivation";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
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
    <button type="button" className={`u-brackets ${styles.button}`} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? "Hide" : "Explain"}<span className="sr-only"> {label}</span>
    </button>
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

function CriterionCard({ s }: { s: Scoped }) {
  const m = useModel();
  const c = s.criterion;
  return (
    <li className={styles.card}>
      <div className={styles.head}>
        <NodeChip id={c.id} size="sm" />
        <VerdictBadge verdict={m.verdictOf(c.id)} />
      </div>
      <div className={styles.lines}>
        <div><span className={styles.label}>Owner</span> <NodeChip id={c.ownerId} size="sm" /></div>
        <div><span className={styles.label}>Subject</span> <NodeChip id={c.subjectId} size="sm" /></div>
        <div><span className={styles.label}>Target</span> {c.targetKind} · gates {c.gates.join(", ") || "none"}</div>
      </div>
      {s.via && <div className={styles.muted}>{s.via.why} <NodeChip id={s.via.id} size="sm" /></div>}
    </li>
  );
}

/** Inspector "Rules & claims": criteria in the node's lineage, derived obligations and findings, each with why. */
export function RulesTab({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const { data } = useReadiness();
  const id = entry.id;

  const scoped = new Map<string, Scoped>();
  const add = (c: Criterion, via?: Scoped["via"]) => { if (!scoped.has(c.id)) scoped.set(c.id, { criterion: c, via }); };
  for (const c of m.criteriaFor(id)) add(c);
  for (const c of m.criteriaOwnedBy(id)) add(c);
  for (const a of m.path(id).slice(0, -1).reverse()) for (const c of m.criteriaFor(a.id)) add(c, { id: a.id, why: "inherited from ancestor" });
  for (const l of m.crossLinks(id)) {
    if (l.rel !== "invokes") continue;
    const other = l.from === id ? l.to : l.from;
    for (const c of m.criteriaFor(other)) add(c, { id: other, why: l.from === id ? "on invoked" : "on caller" });
  }

  const report = (data ?? m.bundle.readiness) as { derived?: Derived };
  const obligations = OBLIGATION_RELATIONS.flatMap((rel) =>
    (report.derived?.[rel] ?? []).filter((t) => t.some((a) => String(a) === id)).map((t) => ({ rel, t })),
  );
  const findings = (data ?? m.bundle.readiness).modelReadiness.findings.filter((f) => f.subject === id);
  const claims = m.index.model.claims.filter((c) => c.activities.includes(id));

  if (!scoped.size && !obligations.length && !findings.length && !claims.length) {
    return <EmptyState title="No criteria, derived obligations, findings or claims reference this object." />;
  }
  return (
    <div className={styles.stack}>
      {scoped.size > 0 && (
        <section aria-label="Criteria" className={styles.section}>
          <h3 className={styles.title}>Criteria</h3>
          <ul className={styles.list}>{[...scoped.values()].map((s) => <CriterionCard key={s.criterion.id} s={s} />)}</ul>
        </section>
      )}
      {obligations.length > 0 && (
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

// tabRegistry -> tabs -> bodies -> this file is an import cycle: tabRegistry may still be evaluating when this
// file loads (a ReferenceError from its `registry` const), so retry until it has finished.
function register(attempt = 0) {
  import("../tabRegistry").then(
    (r) => {
      try {
        r.registerTab("rules", RulesTab);
      } catch (e) {
        if (attempt < 50) setTimeout(() => register(attempt + 1), 0);
        else throw e;
      }
    },
    () => undefined,
  );
}
register();
