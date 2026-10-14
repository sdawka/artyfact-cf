import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import styles from "./Overview.module.css";

/** Every Purpose in full, collapsed: the header already shows the lead sentence. Empty blocks are left out. */
export function PurposeInFull() {
  const m = useModel();
  const ordered = [...m.index.model.purposes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  if (!ordered.length) return null;
  return (
    <details className={styles.details}>
      <summary>Purpose in full</summary>
      <div className={styles.purposes}>
        {ordered.map((p, i) => (
          <section key={p.id} aria-label={`Purpose ${p.id}`} className={styles.purpose}>
            <h3 className={styles.subhead}><code className={styles.purposeId}>{p.id}</code></h3>
            {i > 0 && <p className={styles.statement}>{p.statement}</p>}
            {p.beneficiaries.length > 0 && (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Beneficiaries</h4>
                <ul className={styles.chips}>{p.beneficiaries.map((b) => <li key={b}><NodeChip id={b} size="sm" /></li>)}</ul>
              </div>
            )}
            {p.intendedChange && (
              <div className={styles.block}><h4 className={styles.blockTitle}>Intended change</h4><p className={styles.plainText}>{p.intendedChange}</p></div>
            )}
            {p.successCriteria.length > 0 && (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Success criteria</h4>
                <ul className={styles.bullets}>{p.successCriteria.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
            {p.nonGoals.length > 0 && (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Non-goals</h4>
                <ul className={styles.bullets}>{p.nonGoals.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
