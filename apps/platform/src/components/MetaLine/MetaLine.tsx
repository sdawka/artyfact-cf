import type { ReactNode } from "react";
import styles from "./MetaLine.module.css";

export interface MetaItem {
  /** Label where the value alone is ambiguous ("started", "head"). */
  label?: string;
  value: ReactNode;
  /** Set the value in the code face (ids, shas, paths). */
  code?: boolean;
  /** Full value for a shortened one (an ISO time, a full sha), as a tooltip. */
  title?: string;
}

/**
 * Facts about a row or object, separated by space (`--spacing-3`), never by "·". Missing values say "unknown".
 * Renders a `dl` so each label stays tied to its value.
 */
export function MetaLine({ items, className }: { items: MetaItem[]; className?: string }) {
  return (
    <dl className={[styles.meta, className].filter(Boolean).join(" ")}>
      {items.map((item, i) => (
        <div key={i} className={styles.item}>
          {item.label && <dt>{item.label}</dt>}
          <dd title={item.title}>{item.code ? <code>{item.value}</code> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
