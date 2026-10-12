import { useId } from "react";
import { kindInfo } from "@/model/kinds";
import type { MapFilterState } from "./useMapGraph";
import styles from "./MapFilters.module.css";

export interface MapFiltersProps {
  value: MapFilterState;
  onChange: (next: MapFilterState) => void;
  /** Kinds present in the model. */
  kinds: string[];
  /** Relations present in the model. */
  linkTypes: string[];
  /** Number of readiness findings (shown next to "Findings only"). */
  findingCount: number;
}

const toggle = (list: string[], item: string, hide: boolean) => (hide ? [...list, item] : list.filter((x) => x !== item));

/** Kinds, link types, Externals and findings-only filters for the Map. */
export function MapFilters({ value, onChange, kinds, linkTypes, findingCount }: MapFiltersProps) {
  const id = useId();
  const hiddenKinds = value.hiddenKinds.filter((k) => kinds.includes(k)).length;
  const hiddenLinks = value.hiddenLinks.filter((k) => linkTypes.includes(k)).length;
  const changed = hiddenKinds + hiddenLinks > 0 || !value.showExternals || value.findingsOnly;
  return (
    <section className={styles.filters} aria-labelledby={`${id}-h`}>
      <div className={styles.head}>
        <h2 id={`${id}-h`} className={styles.title}>Filters</h2>
        {changed && (
          <button type="button" className={`u-brackets ${styles.reset}`} onClick={() => onChange({ hiddenKinds: [], hiddenLinks: [], showExternals: true, findingsOnly: false })}>
            Reset
          </button>
        )}
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={value.showExternals} onChange={(e) => onChange({ ...value, showExternals: e.target.checked })} />
        Show Externals
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={value.findingsOnly} onChange={(e) => onChange({ ...value, findingsOnly: e.target.checked })} />
        Findings only <span className={styles.count}>{findingCount}</span>
      </label>
      <details className={styles.group}>
        <summary>
          Kinds{hiddenKinds > 0 && <span className={styles.count}> · {hiddenKinds} hidden</span>}
        </summary>
        <fieldset className={styles.list}>
          <legend className="sr-only">Kinds shown</legend>
          {kinds.map((k) => (
            <label key={k} className={styles.check}>
              <input
                type="checkbox"
                checked={!value.hiddenKinds.includes(k)}
                onChange={(e) => onChange({ ...value, hiddenKinds: toggle(value.hiddenKinds, k, !e.target.checked) })}
              />
              <span aria-hidden="true" className={styles.glyph}>{kindInfo(k).glyph}</span>
              {kindInfo(k).label}
            </label>
          ))}
        </fieldset>
      </details>
      <details className={styles.group}>
        <summary>
          Link types{hiddenLinks > 0 && <span className={styles.count}> · {hiddenLinks} hidden</span>}
        </summary>
        <fieldset className={styles.list}>
          <legend className="sr-only">Link types shown</legend>
          {linkTypes.map((t) => (
            <label key={t} className={styles.check}>
              <input
                type="checkbox"
                checked={!value.hiddenLinks.includes(t)}
                onChange={(e) => onChange({ ...value, hiddenLinks: toggle(value.hiddenLinks, t, !e.target.checked) })}
              />
              {t}
            </label>
          ))}
        </fieldset>
      </details>
    </section>
  );
}
