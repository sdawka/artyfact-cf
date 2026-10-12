import { revisionGroups, type RevisionOption } from "@/model/revisions";
import styles from "./RevisionPicker.module.css";

export interface RevisionPickerProps {
  /** Id of the `<select>`; the visible label points at it. */
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  /** From `useRevisions()`; grouped into head, System commits and candidates. */
  options: RevisionOption[];
}

/** Labelled native select over revisions. An unlisted `value` is still shown (as its short form). */
export function RevisionPicker({ id, label, value, onChange, options }: RevisionPickerProps) {
  return (
    <span className={styles.field}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {revisionGroups(options, value).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  );
}
