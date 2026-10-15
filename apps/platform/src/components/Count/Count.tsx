import styles from "./Count.module.css";

export interface CountProps {
  /** `null` renders "unknown". */
  n: number | null;
  /** `attention`: waits on you, apricot, hidden at zero. `neutral` (default): inventory, subtle, shows 0. */
  tone?: "attention" | "neutral";
  /** Hide at zero; defaults to true for attention, false for neutral. */
  hideZero?: boolean;
  /** Screen-reader words after the number: a link "Review" with `srLabel="waiting"` reads "Review, 2 waiting". */
  srLabel?: string;
}

/** A tabular count, 600 weight, no pill background. */
export function Count({ n, tone = "neutral", hideZero, srLabel }: CountProps) {
  if (n === 0 && (hideZero ?? tone === "attention")) return null;
  return (
    <span className={`u-numeric ${styles.count}`} data-tone={tone}>
      {srLabel && <span className="sr-only">, </span>}
      {n === null ? "unknown" : n}
      {srLabel && <span className="sr-only"> {srLabel}</span>}
    </span>
  );
}
