import styles from "./Legend.module.css";

const NODES = [
  ["action", "User or counterpart action"],
  ["system", "System step"],
  ["external", "External step"],
  ["wait", "Wait"],
  ["decision", "Branch"],
  ["terminal", "End"],
] as const;

/** Key for node shapes and edge styles. Static, so it is a plain description list. */
export function Legend() {
  return (
    <aside className={styles.legend} aria-label="Legend">
      <ul className={styles.list}>
        {NODES.map(([kind, label]) => (
          <li key={kind}>
            <span className={`${styles.swatch} ${styles[kind]}`} aria-hidden="true" />
            {label}
          </li>
        ))}
        <li>
          <svg className={styles.line} viewBox="0 0 32 8" aria-hidden="true">
            <line x1="0" y1="4" x2="32" y2="4" />
          </svg>
          Flow
        </li>
        <li>
          <svg className={`${styles.line} ${styles.failure}`} viewBox="0 0 32 8" aria-hidden="true">
            <line x1="0" y1="4" x2="32" y2="4" />
          </svg>
          Failure path
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.unresolved}`} aria-hidden="true">?</span>
          Provisional step
        </li>
      </ul>
    </aside>
  );
}
