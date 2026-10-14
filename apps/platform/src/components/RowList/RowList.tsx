import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router";
import styles from "./RowList.module.css";

type Density = "standard" | "compact";
const DensityContext = createContext<Density>("standard");

export interface RowListProps {
  /** Accessible name of the list. */
  label: string;
  /** `standard` (default): 44px rows. `compact`: 36px, for non-interactive rows only. */
  density?: Density;
  className?: string;
  children: ReactNode;
}

/** Homogeneous items read one at a time: rows divided by `--color-border-faint`, no box per row. */
export function RowList({ label, density = "standard", className, children }: RowListProps) {
  return (
    <DensityContext.Provider value={density}>
      <ul aria-label={label} className={[styles.list, className].filter(Boolean).join(" ")} data-density={density}>{children}</ul>
    </DensityContext.Provider>
  );
}

export interface RowProps {
  /** The whole row (title, meta, status) is this link. */
  to?: string;
  /** Or the whole row is this button (selection without a URL change). */
  onSelect?: () => void;
  /** Selected/current: left rule + one surface step, `aria-current="true"`. */
  current?: boolean;
  /** Tone of the status slot: `attention` (waits on you) or `fail`. */
  tone?: "neutral" | "attention" | "fail";
  title: ReactNode;
  meta?: ReactNode;
  /** The row's state (StatusText, or one StatusChip). */
  status?: ReactNode;
  /** Actions after the row target, outside the link (compact secondary buttons, a trailing link word). */
  trailing?: ReactNode;
  /** Accessible name of the row target when its content reads poorly concatenated ("Peopling, 2 await your review"). */
  label?: string;
  className?: string;
}

/** One row. With `to` or `onSelect` the whole row is the target; `trailing` stays outside it. */
export function Row({ to, onSelect, current, tone = "neutral", title, meta, status, trailing, label, className }: RowProps) {
  const density = useContext(DensityContext);
  const body = (
    <>
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </span>
      {status && <span className={styles.status} data-tone={tone}>{status}</span>}
    </>
  );
  const sel = current ? "true" : undefined;
  const target = to !== undefined
    ? <Link to={to} className={`u-selectable ${styles.target}`} aria-current={sel} aria-label={label}>{body}</Link>
    : onSelect
      ? <button type="button" className={`u-selectable ${styles.target}`} aria-current={sel} aria-label={label} onClick={onSelect}>{body}</button>
      : <div className={`${styles.target} ${current ? "u-selected" : ""}`}>{body}</div>;
  return (
    <li className={[styles.row, className].filter(Boolean).join(" ")} data-density={density} data-interactive={to !== undefined || onSelect ? "" : undefined}>
      {target}
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </li>
  );
}
