import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Unknown } from "@/components/Unknown/Unknown";
import { stamp } from "./lib";
import styles from "./phenome.module.css";

/** `<time>` text, or the literal unknown. */
export const When = ({ iso }: { iso?: string | null }) => (iso ? <time dateTime={iso}>{stamp(iso)}</time> : <Unknown />);

/**
 * A table row that opens a detail row under it. The whole row toggles (44px target); the first cell carries the
 * keyboard-reachable button. Links and buttons inside the row keep their own action.
 */
export function ExpandRow({ id, label, columns, cells, children }: {
  id: string;
  /** Names the toggle for screen readers: "Details of {label}". */
  label: string;
  columns: number;
  /** The cells after the toggle cell. */
  cells: ReactNode;
  /** The detail. A row without detail is a plain row. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailId = `${id}-detail`;
  const toggle = () => setOpen((o) => !o);
  const onClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("a,button,input,select")) toggle(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) toggle(); };
  return (
    <>
      <tr className={styles.dataRow} data-open={open || undefined} data-expandable={children ? "" : undefined} onClick={children ? onClick : undefined} onKeyDown={children ? onKey : undefined}>
        <td className={styles.toggleCell}>
          {children && (
            <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={detailId} onClick={toggle}>
              <span aria-hidden="true" className="u-glyph">{open ? "▾" : "▸"}</span>
              <span className="sr-only">Details of {label}</span>
            </button>
          )}
        </td>
        {cells}
      </tr>
      {children && open && (
        <tr id={detailId} className={styles.detailRow}>
          <td colSpan={columns + 1}>{children}</td>
        </tr>
      )}
    </>
  );
}
