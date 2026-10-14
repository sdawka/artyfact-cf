import { useState } from "react";
import type { Finding } from "@artyfact/model";
import { useReadiness } from "@/api/queries";
import { Derivation } from "@/components/Derivation/Derivation";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { Button } from "@/components/ui";
import { useModel } from "@/model/useModel";
import { isBlocking } from "../../../shared/verdict";
import { blockerAction } from "./states";
import styles from "./Overview.module.css";

/** Id of the section (the "Needs you" strip scrolls to it). */
export const BLOCKERS_ID = "overview-blockers";

function FindingDetail({ f, id }: { f: Finding; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.finding}>
      <p className={styles.findingText}>
        {f.subject && <NodeChip id={f.subject} size="sm" showId />} {f.message}
      </p>
      <Button variant="ghost" size="compact" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide derivation" : "Show derivation"}
        <span className="sr-only"> of {f.rule} {f.subject ?? ""}</span>
      </Button>
      {open && <div id={id} className={styles.derivation}><Derivation finding={f} /></div>}
    </li>
  );
}

/** One rule, its real next action, and its findings behind a disclosure. */
function RuleRow({ rule, items, prefix, startOpen }: { rule: string; items: Finding[]; prefix: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <Row
      onSelect={() => setOpen((o) => !o)}
      expanded={open}
      tone={startOpen ? "fail" : "neutral"}
      title={<code className={styles.rule}>{rule}</code>}
      meta={blockerAction(rule)}
      status={`${items.length} ${items.length === 1 ? "finding" : "findings"}`}
    >
      <ul className={styles.plain}>
        {items.map((f, i) => <FindingDetail key={`${f.subject}-${i}`} f={f} id={`${prefix}-${rule}-${i}`} />)}
      </ul>
    </Row>
  );
}

function groupByRule(findings: Finding[]) {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  return [...byRule];
}

/** Readiness findings with their next action: errors and missing block (not a provisional node's); the rest are warnings. */
export function BlockersList() {
  const m = useModel();
  const { data } = useReadiness();
  const findings = (data ?? m.bundle.readiness).modelReadiness.findings;
  const blocking = findings.filter(isBlocking);
  const warnings = findings.filter((f) => f.level === "warning" || (f.level === "missing" && !isBlocking(f)));
  return (
    <Section title="Blockers and warnings" id={BLOCKERS_ID}>
      {blocking.length ? (
        <RowList label="Blocking">
          {groupByRule(blocking).map(([rule, items]) => <RuleRow key={rule} rule={rule} items={items} prefix="b" startOpen />)}
        </RowList>
      ) : (
        <p className={styles.quiet}>Nothing blocks this System.</p>
      )}
      {warnings.length > 0 && (
        <>
          <h3 className={styles.subhead}>Warnings <span className={`u-numeric ${styles.quiet}`}>{warnings.length}</span></h3>
          <RowList label="Warnings">
            {groupByRule(warnings).map(([rule, items]) => <RuleRow key={rule} rule={rule} items={items} prefix="w" startOpen={false} />)}
          </RowList>
        </>
      )}
    </Section>
  );
}
