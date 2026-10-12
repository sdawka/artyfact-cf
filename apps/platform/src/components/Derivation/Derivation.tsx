import { useEffect, useState } from "react";
import type { Finding } from "@artyfact/model";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModelOptional } from "@/model/useModel";
import styles from "./Derivation.module.css";

export type DerivationTree = Finding["derivation"];

/** Deepest level shown (root is level 0); anything below renders as "…". */
export const MAX_DEPTH = 6;

/**
 * Props: exactly one of `finding` (its `derivation` is shown) or `derivation`
 * (any `explain()` tree from `@artyfact/rules`, e.g. for a derived relation).
 */
export type DerivationProps = { finding: Pick<Finding, "derivation"> } | { derivation: DerivationTree };

const args = (t: DerivationTree) => t.tuple.map(String);
const head = (t: DerivationTree) => `${t.relation}(${args(t).join(", ")})`;
const origin = (t: DerivationTree) => (t.edb ? "fact" : t.rule ? `rule ${t.rule}` : "derived");

/** Indented plain-text outline, one line per node, depth-limited like the component. */
export function derivationText(tree: DerivationTree, maxDepth = MAX_DEPTH): string {
  const lines: string[] = [];
  const walk = (t: DerivationTree, depth: number) => {
    lines.push(`${"  ".repeat(depth)}${head(t)}  [${origin(t)}]`);
    if (!t.children.length) return;
    if (depth >= maxDepth) lines.push(`${"  ".repeat(depth + 1)}…`);
    else t.children.forEach((c) => walk(c, depth + 1));
  };
  walk(tree, 0);
  return lines.join("\n");
}

function Fact({ node }: { node: DerivationTree }) {
  const model = useModelOptional();
  const a = args(node);
  return (
    <span className={styles.fact}>
      <span className={styles.relation}>{node.relation}</span>
      <span className={styles.punct}>(</span>
      {a.map((arg, i) => (
        <span key={i} className={styles.arg}>
          {i > 0 && <span className={styles.punct}>, </span>}
          {model?.byId(arg) ? <NodeChip id={arg} size="sm" /> : <code>{arg}</code>}
        </span>
      ))}
      <span className={styles.punct}>)</span>
    </span>
  );
}

function Meta({ node }: { node: DerivationTree }) {
  return (
    <span className={styles.meta}>
      {node.edb ? <span>fact</span> : node.rule ? <code>{node.rule}</code> : <span>derived</span>}
      {node.alternatives && node.alternatives > 1 ? <span>{node.alternatives} derivations, first shown</span> : null}
      {node.cycle ? <span>cycle</span> : null}
      {node.truncated ? <span>truncated</span> : null}
    </span>
  );
}

function Node({ node, depth }: { node: DerivationTree; depth: number }) {
  const [open, setOpen] = useState(true);
  const branch = node.children.length > 0;
  const atLimit = depth >= MAX_DEPTH;
  return (
    <li className={styles.item}>
      <div className={styles.line}>
        {branch ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${head(node)}`}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span className={styles.toggle} aria-hidden="true">·</span>
        )}
        <Fact node={node} />
        <Meta node={node} />
      </div>
      {branch && open && (
        atLimit ? (
          <div className={styles.more} aria-label="deeper levels not shown">…</div>
        ) : (
          <ul className={styles.children}>
            {node.children.map((c, i) => (
              <Node key={`${c.relation}-${i}`} node={c} depth={depth + 1} />
            ))}
          </ul>
        )
      )}
    </li>
  );
}

/** Collapsible outline of why a rule fired: rule chain down to the input facts, with a copy-as-text button. */
export function Derivation(props: DerivationProps) {
  const tree = "finding" in props ? props.finding.derivation : props.derivation;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);
  const copy = () => {
    const w = navigator.clipboard?.writeText(derivationText(tree)) ?? Promise.reject(new Error("clipboard unavailable"));
    w.then(() => setState("copied"), () => setState("failed"));
  };
  return (
    <div className={styles.derivation}>
      <ul aria-label={`Derivation of ${head(tree)}`} className={styles.tree}>
        <Node node={tree} depth={0} />
      </ul>
      <div className={styles.foot}>
        <button
          type="button"
          className={`u-brackets ${styles.copy}`}
          aria-label="Copy derivation as text"
          onClick={copy}
        >
          {state === "idle" ? "Copy as text" : state === "copied" ? "Copied" : "Copy failed"}
        </button>
        <span className="sr-only" role="status">
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}
        </span>
      </div>
    </div>
  );
}
