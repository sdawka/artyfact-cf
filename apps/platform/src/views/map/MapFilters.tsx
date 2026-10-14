import { Button, Checkbox } from "@/components/ui";
import { useId } from "react";
import { kindColour, useKindViews } from "@/model/kinds";
import { DEFAULT_FILTERS, type MapFilterState } from "./useMapGraph";
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

/** Template layers (the Map bands), kinds, link types, Externals and findings-only filters for the Map. */
export function MapFilters({ value, onChange, kinds, linkTypes, findingCount }: MapFiltersProps) {
  const id = useId();
  const views = useKindViews();
  const hiddenKinds = value.hiddenKinds.filter((k) => kinds.includes(k)).length;
  const hiddenLinks = value.hiddenLinks.filter((k) => linkTypes.includes(k)).length;
  const layers = views.layers;
  const hiddenLayers = value.hiddenLayers.filter((l) => layers.some((x) => x.id === l)).length;
  const changed = hiddenKinds + hiddenLinks + hiddenLayers > 0 || !value.showExternals || value.findingsOnly;
  return (
    <section className={styles.filters} aria-labelledby={`${id}-h`}>
      <div className={styles.head}>
        <h2 id={`${id}-h`} className={styles.title}>Filters</h2>
        {changed && (
          <Button variant="ghost" type="button" onClick={() => onChange(DEFAULT_FILTERS)}>
            Reset
          </Button>
        )}
      </div>
      <label className={styles.check}>
        <Checkbox checked={value.showExternals} onChange={(e) => onChange({ ...value, showExternals: e.target.checked })} />
        Show Externals
      </label>
      <label className={styles.check}>
        <Checkbox checked={value.findingsOnly} onChange={(e) => onChange({ ...value, findingsOnly: e.target.checked })} />
        Findings only <span className={styles.count}>{findingCount}</span>
      </label>
      {layers.length > 0 && (
        <details className={styles.group} open>
          <summary>
            Layers{hiddenLayers > 0 && <span className={styles.count}> · {hiddenLayers} hidden</span>}
          </summary>
          <fieldset className={styles.list}>
            <legend className="sr-only">Layers shown</legend>
            {layers.map((l) => (
              <label key={l.id} className={styles.check} title={l.description}>
                <Checkbox
                  checked={!value.hiddenLayers.includes(l.id)}
                  onChange={(e) => onChange({ ...value, hiddenLayers: toggle(value.hiddenLayers, l.id, !e.target.checked) })}
                />
                {l.label}
              </label>
            ))}
          </fieldset>
        </details>
      )}
      <details className={styles.group}>
        <summary>
          Kinds{hiddenKinds > 0 && <span className={styles.count}> · {hiddenKinds} hidden</span>}
        </summary>
        <fieldset className={styles.list}>
          <legend className="sr-only">Kinds shown</legend>
          {kinds.map((k) => (
            <label key={k} className={styles.check}>
              <Checkbox
                checked={!value.hiddenKinds.includes(k)}
                onChange={(e) => onChange({ ...value, hiddenKinds: toggle(value.hiddenKinds, k, !e.target.checked) })}
              />
              <span aria-hidden="true" className={styles.glyph} style={kindColour(views.of(k))}>{views.of(k).glyph}</span>
              {views.of(k).label}
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
              <Checkbox
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
