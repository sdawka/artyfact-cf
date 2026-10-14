import { Button } from "@/components/ui";
import { RevisionPicker } from "@/components/RevisionPicker/RevisionPicker";
import type { RevisionOption } from "@/model/revisions";
import styles from "./compare.module.css";

interface Props {
  from: string;
  to: string;
  options: RevisionOption[];
  onChange(pair: { from: string; to: string }): void;
}

/** Two revision pickers and a Swap button. */
export function ComparePicker({ from, to, options, onChange }: Props) {
  return (
    <div className={styles.picker}>
      <RevisionPicker id="compare-from" label="From" value={from} options={options} onChange={(v) => onChange({ from: v, to })} />
      <Button type="button" variant="secondary" onClick={() => onChange({ from: to, to: from })}>
        <span aria-hidden="true">⇄ </span>Swap
      </Button>
      <RevisionPicker id="compare-to" label="To" value={to} options={options} onChange={(v) => onChange({ from, to: v })} />
    </div>
  );
}
