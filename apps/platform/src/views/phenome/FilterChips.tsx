import { useSearchParams } from "react-router";
import { Button } from "@/components/ui";
import styles from "./phenome.module.css";

/** The event filters the URL can carry, in display order. */
export const FILTERS = [
  ["deployment", "Deployment"], ["build", "Build"], ["output", "Output"], ["kind", "Kind"], ["commit", "Commit"], ["realization", "Realization"],
] as const;

/** Set or clear one filter param, keeping the rest of the URL. */
export function useSetFilter() {
  const [, setParams] = useSearchParams();
  return (key: string, value: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  });
}

/** The active filters as removable chips, with "Clear filters". Nothing when none is set. */
export function FilterChips() {
  const [params, setParams] = useSearchParams();
  const set = useSetFilter();
  const active = FILTERS.filter(([key]) => params.get(key));
  if (!active.length) return null;
  const clear = () => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [key] of FILTERS) next.delete(key);
    return next;
  });
  return (
    <ul className={styles.chips} aria-label="Active filters">
      {active.map(([key, label]) => (
        <li key={key} className={styles.chip}>
          <span>{label} <code>{params.get(key)}</code></span>
          <button type="button" className={styles.chipRemove} aria-label={`Remove ${label} filter`} onClick={() => set(key, null)}>
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
      <li><Button variant="ghost" size="compact" onClick={clear}>Clear filters</Button></li>
    </ul>
  );
}
