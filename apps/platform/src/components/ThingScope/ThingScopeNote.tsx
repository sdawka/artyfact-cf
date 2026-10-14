import { Button } from "@/components/ui";
import type { ThingFilter } from "@/model/useThingFilter";
import styles from "./ThingScopeNote.module.css";

/**
 * "Showing {Thing} · Show all" under a view's header while the Thing filter applies; "Showing all of the System ·
 * Show only {Thing}" after it was lifted. Renders nothing outside a Thing path.
 */
export function ThingScopeNote({ filter }: { filter: ThingFilter }) {
  const { thing, active, setShowAll } = filter;
  if (!thing) return null;
  return (
    <p className={styles.note} data-testid="thing-scope-note">
      {active ? <>Showing <strong>{thing.name}</strong></> : <>Showing everything in this System</>}
      <Button variant="ghost" size="compact" onClick={() => setShowAll(active)}>
        {active ? "Show all" : `Show only ${thing.name}`}
      </Button>
    </p>
  );
}
