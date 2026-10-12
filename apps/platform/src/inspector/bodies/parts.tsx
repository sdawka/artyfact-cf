import type { ReactNode } from "react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import { useModel } from "@/model/useModel";
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

export function Lines({ items }: { items: readonly string[] }) {
  if (!items.length) return <span className={styles.muted}>none</span>;
  return <ul className={styles.lines}>{items.map((s, i) => <li key={`${i}-${s}`}>{s}</li>)}</ul>;
}

export function Text({ children }: { children?: string }) {
  return children ? <p className={styles.text}>{children}</p> : null;
}

/** Cross-link neighbours of `entry` for one relation: `out` = this → other, `in` = other → this. */
export function useLinked(entry: IndexEntry, rel: string, dir: "out" | "in"): string[] {
  const m = useModel();
  return m.crossLinks(entry.id)
    .filter((l) => l.rel === rel && (dir === "out" ? l.from === entry.id : l.to === entry.id))
    .map((l) => (dir === "out" ? l.to : l.from))
    .filter((id, i, xs) => xs.indexOf(id) === i);
}

export function MutedValue({ value }: { value?: string | number | null }) {
  return value === undefined || value === null || value === "" ? <span className={styles.muted}>unknown</span> : <>{value}</>;
}
