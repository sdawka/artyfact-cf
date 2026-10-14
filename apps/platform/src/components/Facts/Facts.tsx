import type { ReactNode } from "react";
import styles from "./Facts.module.css";

export { styles as factsStyles };

export interface Fact { term: ReactNode; value: ReactNode; key?: string }

/** A two-column `dl` of labelled facts (one column below 640px). Pass `items`, or `dt`/`dd` pairs as children. */
export function Facts({ items, children, className }: { items?: Fact[]; children?: ReactNode; className?: string }) {
  return (
    <dl className={[styles.facts, className].filter(Boolean).join(" ")}>
      {items?.map((f, i) => [<dt key={`t${f.key ?? i}`}>{f.term}</dt>, <dd key={`d${f.key ?? i}`}>{f.value}</dd>])}
      {children}
    </dl>
  );
}
