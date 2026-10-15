import styles from "./Unknown.module.css";

/** The literal word for a value that is not known. For values only: an absence says "{Thing} yet." instead. */
export function Unknown({ children = "unknown" }: { children?: string }) {
  return <span className={styles.unknown}>{children}</span>;
}
