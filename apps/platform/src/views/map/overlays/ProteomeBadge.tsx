import styles from "./overlays.module.css";

/** Realizations whose evolution affects the node (the node gets an apricot ring when > 0). */
export function ProteomeBadge({ count }: { count: number }) {
  const text = `${count} ${count === 1 ? "realization" : "realizations"}`;
  return (
    <span className={styles.proteome} data-active={count > 0 || undefined} aria-label={text} role="img">
      <span aria-hidden="true">⎇</span> {text}
    </span>
  );
}
