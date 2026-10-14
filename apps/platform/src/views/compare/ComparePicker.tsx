import { SwitchIcon } from "@radix-ui/react-icons";
import { IconButton } from "@/components/ui";
import { RevisionPicker } from "@/components/RevisionPicker/RevisionPicker";
import type { RevisionOption } from "@/model/revisions";
import styles from "./compare.module.css";

interface Props {
  from: string;
  to: string;
  options: RevisionOption[];
  onChange(pair: { from: string; to: string }): void;
}

/** One labelled group that reads "Compare [from] [swap] [to]"; the two pickers keep their From / To names. */
export function ComparePicker({ from, to, options, onChange }: Props) {
  return (
    <div className={styles.picker} role="group" aria-label="Revisions to compare">
      <span className={styles.pickerLead} aria-hidden="true">Compare</span>
      <RevisionPicker id="compare-from" label="From" hideLabel value={from} options={options} onChange={(v) => onChange({ from: v, to })} />
      <IconButton label="Swap revisions" variant="secondary" onClick={() => onChange({ from: to, to: from })}>
        <SwitchIcon aria-hidden="true" />
      </IconButton>
      <RevisionPicker id="compare-to" label="To" hideLabel value={to} options={options} onChange={(v) => onChange({ from, to: v })} />
    </div>
  );
}
