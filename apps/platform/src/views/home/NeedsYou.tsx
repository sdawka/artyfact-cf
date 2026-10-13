import { Link } from "react-router";
import { needsYou, type CardSummary } from "./signifiers";
import styles from "./home.module.css";

/** One row per decision waiting on a person across all Systems; one quiet line when there are none. */
export function NeedsYou({ systems }: { systems: readonly CardSummary[] }) {
  const rows = needsYou(systems);
  return (
    <section className={styles.ledger} aria-labelledby="needs-you-title">
      <h2 id="needs-you-title" className={styles.h2}>Needs you</h2>
      {rows.length === 0 ? (
        <p className={styles.ledgerEmpty}>Nothing is waiting on you.</p>
      ) : (
        <ul className={styles.ledgerList}>
          {rows.map((r) => (
            <li key={r.key} className={styles.ledgerRow} data-tone={r.tone}>
              <Link to={r.href} className="u-marker">{r.title}</Link>
              <span className={styles.ledgerText}> · {r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
