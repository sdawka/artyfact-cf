import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusText } from "@/components/StatusText/StatusText";
import type { TheoryClaim } from "@/model/types";
import { useSelection } from "@/model/useSelection";
import { ClaimStatus } from "./ClaimStatus";
import styles from "./ClaimList.module.css";

function Chain({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return <span className={styles.none}>none stated</span>;
  return <>{ids.map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}</>;
}

/** One claim per row, read purpose-to-outcome; the whole row opens the claim in the Inspector. */
export function ClaimList({ claims }: { claims: readonly TheoryClaim[] }) {
  const { focusId, setFocus } = useSelection();
  return (
    <ul className={styles.list} aria-label="Claims">
      {claims.map((c) => (
        <li key={c.id} className={styles.claim} data-claim={c.id} data-deferred={c.deferred || undefined}>
          <button type="button" className={`u-selectable ${styles.target}`} aria-current={focusId === c.id ? "true" : undefined} onClick={() => setFocus(c.id)}>
            <span className={styles.head}>
              <span className={styles.name}><NodeChip id={c.id} size="md" interactive={false} /></span>
              <span className={styles.states}>
                {c.deferred && <StatusText status="deferred" />}
                <ClaimStatus status={c.status} />
              </span>
            </span>
            <span className={styles.chain}>
              <span className={styles.step}><span className={styles.label}>Beneficiaries</span><span className={styles.value}><Chain ids={c.beneficiaries} /></span></span>
              <span className={styles.arrow} aria-hidden="true">→</span>
              <span className={styles.step}><span className={styles.label}>Activities</span><span className={styles.value}><Chain ids={c.activities} /></span></span>
              <span className={styles.arrow} aria-hidden="true">→</span>
              <span className={styles.step}><span className={styles.label}>Outputs</span><span className={styles.value}>{c.mechanism}</span></span>
              <span className={styles.arrow} aria-hidden="true">→</span>
              <span className={styles.step}><span className={styles.label}>Outcomes</span><span className={styles.value}>{c.outcome}</span></span>
            </span>
            <span className={styles.indicator}><span className={styles.label}>Indicator</span> {c.indicator}</span>
          </button>
          <details className={styles.method}>
            <summary>Evaluation method</summary>
            <p>{c.evaluationMethod}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
