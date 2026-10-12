import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import styles from "./Overview.module.css";

/** P1 first: statement, beneficiaries, intended change, success criteria, non-goals. `leadShown` skips the first statement (the hero shows it). */
export function PurposeCard({ leadShown = false }: { leadShown?: boolean } = {}) {
  const m = useModel();
  const purposes = m.index.model.purposes;
  const ordered = [...purposes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  if (!ordered.length) {
    if (leadShown) return null;
    return (
      <section className={styles.card} aria-labelledby="purpose-title">
        <h2 id="purpose-title" className={styles.cardTitle}>Purpose</h2>
        <p className={styles.muted}>This System declares no Purpose.</p>
      </section>
    );
  }
  return (
    <>
      {ordered.map((p, i) => (
        <section key={p.id} className={styles.card} aria-labelledby={`purpose-${p.id}`}>
          <h2 id={`purpose-${p.id}`} className={styles.cardTitle}>
            <span className={styles.purposeId}>{p.id}</span> Purpose
          </h2>
          {!(leadShown && i === 0) && <p className={styles.statement}>{p.statement}</p>}
          <div className={styles.cols}>
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>Beneficiaries</h3>
              <ul className={styles.chips}>
                {p.beneficiaries.map((b) => <li key={b}><NodeChip id={b} size="sm" /></li>)}
              </ul>
              <h3 className={styles.blockTitle}>Intended change</h3>
              <p className={styles.plainText}>{p.intendedChange}</p>
            </div>
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>Success criteria</h3>
              <ul className={styles.bullets}>{p.successCriteria.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>Non-goals</h3>
              <ul className={styles.bullets}>{p.nonGoals.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
