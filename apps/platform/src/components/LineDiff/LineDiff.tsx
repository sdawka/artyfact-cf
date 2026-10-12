import { Fragment, useMemo, useState } from "react";
import { lineDiff, type DiffLine } from "./hunks";
import styles from "./LineDiff.module.css";

export interface LineDiffProps {
  /** Old text; null = the path did not exist (every line is an addition). */
  from: string | null;
  /** New text; null = the path was removed (every line is a deletion). */
  to: string | null;
  /** Accessible name of the diff table, e.g. the path. */
  label: string;
  context?: number;
}

const SIGN = { add: "+", del: "−", ctx: " " } as const;
const OP_LABEL = { add: "added", del: "removed", ctx: "unchanged" } as const;

function Row({ line }: { line: DiffLine }) {
  return (
    <tr data-op={line.op} className={styles.row}>
      <td className={styles.num}>{line.oldNo ?? ""}</td>
      <td className={styles.num}>{line.newNo ?? ""}</td>
      <td className={styles.sign} aria-label={OP_LABEL[line.op]}>{SIGN[line.op]}</td>
      <td className={styles.text}><pre>{line.text || " "}</pre></td>
    </tr>
  );
}

/** Unified line diff: hunks with 3 lines of context, longer unchanged runs folded behind "… n unchanged" buttons. */
export function LineDiff({ from, to, label, context = 3 }: LineDiffProps) {
  const diff = useMemo(() => lineDiff(from, to, context), [from, to, context]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  if (!diff.blocks.length) return <p className={styles.muted}>Both sides are empty.</p>;
  return (
    <div className={styles.wrap}>
      <p className={styles.stats}>
        <span>+{diff.added}</span> <span>−{diff.removed}</span> lines
      </p>
      <table className={styles.table} aria-label={label}>
        <tbody>
          {diff.blocks.map((b, i) =>
            b.kind === "hunk" || open.has(i) ? (
              <Fragment key={i}>{b.lines.map((l, k) => <Row key={k} line={l} />)}</Fragment>
            ) : (
              <tr key={i} className={styles.gap}>
                <td colSpan={4}>
                  <button type="button" className={styles.expand} onClick={() => setOpen(new Set([...open, i]))}>
                    … {b.lines.length} unchanged line{b.lines.length === 1 ? "" : "s"}
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
