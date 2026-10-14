import { Button } from "@/components/ui";
import { useId, useState } from "react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Derivation } from "@/components/Derivation/Derivation";
import { LevelBadge } from "@/inspector/bodies/FindingBody";
import type { Finding } from "../../../../../shared/api";
import styles from "../AmendmentReview.module.css";
import type { ReadinessDiff as Diff } from "./diffReadiness";

function Row({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <li className={styles.finding}>
      <div className={styles.findingHead}>
        <LevelBadge level={finding.level} />
        <code>{finding.rule}</code>
        {finding.subject && <NodeChip id={finding.subject} size="sm" />}
      </div>
      <p className={styles.message}>{finding.message}</p>
      <Button variant="ghost" type="button" className={styles.link} aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Derivation
      </Button>
      <div id={panel} hidden={!open}>
        {open && <Derivation finding={finding} />}
      </div>
    </li>
  );
}

function List({ label, findings }: { label: string; findings: Finding[] }) {
  return (
    <div>
      <h4 className={styles.groupHead}>
        {label} <span className={styles.muted}>{findings.length}</span>
      </h4>
      {findings.length ? (
        <ul className={styles.findingList} aria-label={`${label} findings`}>
          {findings.map((f, i) => (
            <Row key={`${f.rule}:${f.subject ?? ""}:${i}`} finding={f} />
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>none</p>
      )}
    </div>
  );
}

/** Findings the change resolves and findings it adds; hard violations are called out. */
export function ReadinessDiff({ diff }: { diff: Diff }) {
  return (
    <div className={styles.stack}>
      {diff.hardAdded.length > 0 && (
        <p className={styles.blocks} data-tone="fail" role="alert">
          <span aria-hidden="true">× </span>Blocks acceptance:{" "}
          {diff.hardAdded.map((f) => `${f.rule}${f.subject ? ` on ${f.subject}` : ""}`).join("; ")}
        </p>
      )}
      <List label="Resolved" findings={diff.resolved} />
      <List label="Added" findings={diff.added} />
    </div>
  );
}
