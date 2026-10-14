import styles from "./overlays.module.css";

/** Realizations whose evolution affects the node; nothing is drawn at zero. */
export function ProteomeBadge({ count }: { count: number }) {
  if (count === 0) return null;
  const text = `${count} ${count === 1 ? "realization" : "realizations"}`;
  return (
    <span className={styles.proteome} aria-label={text} role="img">
      <span aria-hidden="true">⎇</span> {text}
    </span>
  );
}
