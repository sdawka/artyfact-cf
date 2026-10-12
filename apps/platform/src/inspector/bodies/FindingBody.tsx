import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { Finding } from "../../../shared/api";
import { registerBody, type BodyProps } from "./registry";
import styles from "./FindingBody.module.css";

type Tree = Finding["derivation"];

const render = (t: Tree) => `${t.relation}(${t.tuple.join(", ")})`;

function TreeNode({ tree }: { tree: Tree }) {
  return (
    <li>
      <code>{render(tree)}</code>
      {tree.edb ? <span className={styles.muted}> input fact</span> : tree.rule && <span className={styles.muted}> via {tree.rule}</span>}
      {tree.truncated && <span className={styles.muted}> (truncated)</span>}
      {tree.cycle && <span className={styles.muted}> (cycle)</span>}
      {tree.children.length > 0 && (
        <ul className={styles.outline}>
          {tree.children.map((c, i) => (
            <TreeNode key={i} tree={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Minimal derivation outline. Swap for `components/Derivation` (slice 2.3) once it is on this
 * branch; this is the only place that renders a derivation for findings.
 */
export function DerivationOutline({ tree }: { tree: Tree }) {
  return (
    <ul className={styles.outline} aria-label="Derivation tree">
      <TreeNode tree={tree} />
    </ul>
  );
}

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
      {showDerivation && <DerivationOutline tree={finding.derivation} />}
    </div>
  );
}

/** Inspector What body for focus ids shaped `finding:<rule>:<subject>` whose entry item is a Finding. */
function FindingEntryBody({ entry }: BodyProps) {
  return <FindingBody finding={entry.item as Finding} />;
}
registerBody("finding", FindingEntryBody);
