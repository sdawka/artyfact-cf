import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { StepNode, StepNodeType } from "../useJourneyGraph";
import styles from "./NodeShell.module.css";
import { useStepContext } from "./StepContext";

const ACTOR_LABEL = { user: "User", system: "System", external: "External", counterpart: "Counterpart" } as const;
const KIND_MARK: Partial<Record<string, { glyph: string; label: string }>> = {
  wait: { glyph: "⧖", label: "wait" },
  failure: { glyph: "✕", label: "failure" },
  end: { glyph: "■", label: "end" },
  branch: { glyph: "◇", label: "decision" },
  reaction: { glyph: "↩", label: "reaction" },
};

/** Shared body of every step node: one real button, so steps are reachable by Tab and Enter. */
export function NodeShell({ type, data }: Pick<NodeProps<StepNode>, "data"> & { type: StepNodeType }) {
  const { step, failure, unresolved } = data;
  const { activeStep, pick } = useStepContext();
  const selected = activeStep === step.id;
  const mark = KIND_MARK[step.kind];
  const refs = [step.screen, step.operation, step.external].filter((r): r is string => !!r);
  const label = `Step ${step.id}: ${step.action}. ${ACTOR_LABEL[step.actor]}, ${step.kind}${unresolved ? ", unresolved" : ""}`;
  const decision = type === "decision";
  return (
    <>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <button
        type="button"
        className={`u-brackets ${styles.node} ${styles[type]}`}
        data-failure={failure || undefined}
        data-unresolved={unresolved || undefined}
        aria-pressed={selected}
        aria-label={label}
        onClick={() => pick(step.id)}
      >
        {decision && (
          <svg className={styles.diamond} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <span className={styles.meta}>
          <code className={styles.id}>{step.id}</code>
          <span>{ACTOR_LABEL[step.actor]}</span>
          {mark && (
            <span className={styles.mark}>
              <span aria-hidden="true">{mark.glyph}</span> {mark.label}
            </span>
          )}
          {unresolved && (
            <span className={styles.unresolved} title="Provisional step">
              ?<span className="sr-only"> unresolved</span>
            </span>
          )}
        </span>
        <span className={styles.action}>{step.action}</span>
        {!decision && refs.length > 0 && (
          <span className={styles.refs}>
            {refs.slice(0, 2).map((r) => (
              <NodeChip key={r} id={r} size="sm" interactive={false} />
            ))}
          </span>
        )}
      </button>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </>
  );
}
