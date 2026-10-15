import { useState } from "react";
import type { SystemCompare } from "../../../shared/api";
import { Button } from "@/components/ui";
import { StatusText } from "@/components/StatusText/StatusText";
import { systemRows, systemSentence } from "./systemRows";
import styles from "./compare.module.css";

/** The two System commits side by side: changed rows first, the unchanged ones behind "Show n unchanged". */
export function SystemLevel({ cmp }: { cmp: SystemCompare }) {
  const [all, setAll] = useState(false);
  const rows = systemRows(cmp);
  const changed = rows.filter((r) => r.changed);
  const same = rows.filter((r) => !r.changed);
  const shown = all ? [...changed, ...same] : changed;
  return (
    <>
      <p role="status" className={styles.sentence}>{systemSentence(rows)}</p>
      {shown.length > 0 && (
        <table className={styles.table}>
          <caption className="sr-only">System commits compared</caption>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} data-changed={r.changed || undefined}>
                <th scope="row">{r.label}</th>
                <td data-label="From">{r.from}</td>
                <td data-label="To">{r.to}</td>
                <td className={styles.change}>
                  {r.changed ? <StatusText status="changed" glyph="~" /> : <StatusText status="same" glyph="–" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {same.length > 0 && (
        <Button type="button" variant="ghost" size="compact" className={styles.more} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Hide unchanged" : `Show ${same.length} unchanged`}
        </Button>
      )}
    </>
  );
}
