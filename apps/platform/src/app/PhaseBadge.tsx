import styles from "./StatePill.module.css";

/** The System's lifecycle phase from the root `node.yaml` (e.g. "unrealized"); literal "unknown" when absent. */
export function PhaseBadge({ phase }: { phase: string | undefined }) {
  return (
    <span className={styles.pill} data-state="phase" title="System phase">
      Phase: {phase ?? "unknown"}
    </span>
  );
}
