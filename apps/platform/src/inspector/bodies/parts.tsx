import type { ReactNode } from "react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import styles from "./Bodies.module.css";

/** Small layout helpers shared by the kind bodies. Registers nothing. */

export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

/** A labelled row; renders nothing when `show` is false so empty facets stay out of the way. */
export function Row({ label, children, show = true }: { label: string; children: ReactNode; show?: boolean }) {
  if (!show) return null;
  return (
    <div className={styles.row}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

export function Chips({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return <span className={styles.muted}>none</span>;
  return (
    <ul className={styles.chips}>
      {ids.map((id) => <li key={id}><NodeChip id={id} size="sm" /></li>)}
    </ul>
  );
}

export function Text({ children }: { children?: string }) {
  return children ? <p className={styles.text}>{children}</p> : null;
}


