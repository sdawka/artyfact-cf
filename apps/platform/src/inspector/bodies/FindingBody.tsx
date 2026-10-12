import { Derivation } from "@/components/Derivation/Derivation";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { Finding } from "../../../shared/api";
import { registerBody, type BodyProps } from "./registry";
import styles from "./FindingBody.module.css";

const GLYPH: Record<Finding["level"], string> = { error: "×", missing: "?", warning: "!", info: "i" };

/** Glyph + word. `error` is the only red level; nothing here is ever green. */
export function LevelBadge({ level }: { level: Finding["level"] }) {
  return (
    <span className={`u-verdict ${styles.level}`} data-level={level} data-tone={level === "error" ? "fail" : "subtle"}>
      <span aria-hidden="true">{GLYPH[level]}</span> {level}
    </span>
  );
}

/** Rule id, message, level, subject chip and derivation of one rule finding. */
export function FindingBody({ finding, showDerivation = true }: { finding: Finding; showDerivation?: boolean }) {
  return (
    <div className={styles.body}>
      <div className={styles.head}>
        <LevelBadge level={finding.level} />
        <code>{finding.rule}</code>
        {finding.subject && <NodeChip id={finding.subject} size="sm" />}
      </div>
      <p className={styles.message}>{finding.message}</p>
      {showDerivation && <Derivation finding={finding} />}
    </div>
  );
}

/** Inspector What body for focus ids shaped `finding:<rule>:<subject>` whose entry item is a Finding. */
function FindingEntryBody({ entry }: BodyProps) {
  return <FindingBody finding={entry.item as Finding} />;
}
registerBody("finding", FindingEntryBody);
