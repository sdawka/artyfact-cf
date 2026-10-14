import type { ReactNode } from "react";
import styles from "./EntryLayout.module.css";

export { styles as entryStyles };

/** Frame for pages outside the System shell: a header, then `main#main` (focus target, tabIndex -1). */
export function EntryLayout({ header, children }: { header: ReactNode; children: ReactNode }) {
  return <div className={styles.page}>{header}<main id="main" className={styles.main} tabIndex={-1}>{children}</main></div>;
}
