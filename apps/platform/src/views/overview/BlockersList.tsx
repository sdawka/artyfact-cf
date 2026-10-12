import { useState } from "react";
import type { Finding } from "@artyfact/model";
import { useReadiness } from "@/api/queries";
import { Derivation } from "@/components/Derivation/Derivation";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { blockerAction } from "./states";
import styles from "./Overview.module.css";

function FindingRow({ f, id }: { f: Finding; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.finding}>
      <div className={styles.findingHead}>
        <code className={styles.rule}>{f.rule}</code>
        <span className={styles.level}>{f.level}</span>
        {f.subject && <NodeChip id={f.subject} size="sm" showId />}
      </div>
      <p className={styles.plainText}>{f.message}</p>
      <p className={styles.action}><span className={styles.muted}>Next action</span> {blockerAction(f.rule)}</p>
      <button
        type="button"
        className={`u-brackets ${styles.smallButton}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide" : "Explain"}
        <span className="sr-only"> {f.rule} {f.subject ?? ""}</span>
      </button>
      {open && <div id={id} className={styles.derivation}><Derivation finding={f} /></div>}
    </li>
  );
}

function Group({ rule, items, prefix }: { rule: string; items: Finding[]; prefix: string }) {
  const [open, setOpen] = useState(items.length === 1);
  if (items.length === 1) return <FindingRow f={items[0]!} id={`${prefix}-${rule}-0`} />;
  return (
    <li className={styles.group}>
      <button
        type="button"
        className={`u-brackets ${styles.groupButton}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <code className={styles.rule}>{rule}</code> <span className={styles.muted}>{items.length} findings</span>
        <span className="sr-only">{open ? ", hide" : ", show"}</span>
      </button>
      <p className={styles.action}><span className={styles.muted}>Next action</span> {blockerAction(rule)}</p>
      {open && (
        <ul className={styles.plain}>
          {items.map((f, i) => <FindingRow key={`${f.subject}-${i}`} f={f} id={`${prefix}-${rule}-${i}`} />)}
        </ul>
      )}
    </li>
  );
}

function List({ title, empty, findings, prefix }: { title: string; empty: string; findings: Finding[]; prefix: string }) {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  // Single findings first so a lone, specific problem is not buried under a family of repeats.
  const groups = [...byRule].sort(([, a], [, b]) => Number(a.length > 1) - Number(b.length > 1));
  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>{title} <span className={styles.count}>{findings.length}</span></h3>
      {groups.length ? (
        <ul className={styles.plain}>
          {groups.map(([rule, items]) => <Group key={rule} rule={rule} items={items} prefix={prefix} />)}
        </ul>
      ) : (
        <p className={styles.muted}>{empty}</p>
      )}
    </div>
  );
}

/** Readiness findings with why: errors and missing block; warnings are listed apart. */
export function BlockersList() {
  const m = useModel();
  const { data } = useReadiness();
  const findings = (data ?? m.bundle.readiness).modelReadiness.findings;
  const blocking = findings.filter((f) => f.level === "error" || f.level === "missing");
  const warnings = findings.filter((f) => f.level === "warning");
  return (
    <section className={styles.card} aria-labelledby="blockers-title">
      <h2 id="blockers-title" className={styles.cardTitle}>Blockers</h2>
      <List title="Blocking" empty="No errors or missing items." findings={blocking} prefix="b" />
      <List title="Warnings" empty="No warnings." findings={warnings} prefix="w" />
    </section>
  );
}
