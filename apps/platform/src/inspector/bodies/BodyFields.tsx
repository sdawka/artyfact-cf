import type { ReactNode } from "react";
import styles from "./BodyFields.module.css";

/** Labelled row shared by the step, claim and purpose What-bodies. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.key}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

export const Fields = ({ children }: { children: ReactNode }) => <dl className={styles.fields}>{children}</dl>;

export const Chips = ({ children }: { children: ReactNode }) => <span className={styles.chips}>{children}</span>;

export function Bullets({ items, empty }: { items: readonly string[]; empty?: string }) {
  if (items.length === 0) return <span className={styles.muted}>{empty ?? "none"}</span>;
  return (
    <ul className={styles.bullets}>
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <span className={styles.muted}>{children}</span>;
