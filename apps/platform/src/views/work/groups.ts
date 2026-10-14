// Work's classifier: the list pane's groups, and the active set that Overview and the System vitals count.
import type { Evolution } from "../../../shared/api";
import { STATE_GROUPS, TERMINAL } from "./lib";
import type { EvolutionSignal } from "./useEvolutionSignals";

export interface EvolutionGroup {
  key: string;
  label: string;
  items: Evolution[];
  /** Some item waits on a person (awaits review, overlaps): the group opens. */
  attention: boolean;
  /** Promoted, rejected, withdrawn, Legacy: collapsed unless it holds attention or the selection. */
  quiet: boolean;
}

const ACTIVE = new Set(["actionable", "realizing", "evaluated"]);
const needsYou = (s: EvolutionSignal | undefined) => !!s && (s.awaiting > 0 || s.overlap);

/**
 * State groups in lifecycle order, then "Legacy" last: legacy (non Genome) Evolutions are read-only history unless they
 * are active or wait on someone, in which case they stay in their state's group.
 */
export function groupEvolutions(evolutions: readonly Evolution[], signals: ReadonlyMap<string, EvolutionSignal>): EvolutionGroup[] {
  const isLegacy = (e: Evolution) => e.kind !== "genome-amendment" && !ACTIVE.has(e.state) && !needsYou(signals.get(e.id));
  const groups: EvolutionGroup[] = STATE_GROUPS
    .filter((g) => g.state !== "withdrawn" || evolutions.some((e) => e.state === "withdrawn"))
    .map((g) => {
      const items = evolutions.filter((e) => e.state === g.state && !isLegacy(e));
      return { key: g.state, label: g.label, items, attention: items.some((e) => needsYou(signals.get(e.id))), quiet: TERMINAL.has(g.state) };
    });
  const legacy = evolutions.filter(isLegacy);
  if (legacy.length) groups.push({ key: "legacy", label: "Legacy", items: legacy, attention: false, quiet: true });
  return groups;
}

/** The Evolutions in the order the list shows them (groups top to bottom). */
export const listOrder = (groups: readonly EvolutionGroup[]) => groups.flatMap((g) => g.items);

/** Active states, nearest to done first. promoted, rejected and withdrawn are finished, not active. */
const ORDER = ["actionable", "realizing", "evaluated", "genome-approved", "proposed"];

/**
 * The Evolutions Work groups under an unfinished state, by Work's own classifier: Legacy (read-only history) and the
 * terminal groups are left out, so Overview and Work agree on what is active and in which state.
 */
export function activeEvolutions(all: readonly Evolution[], signals: ReadonlyMap<string, EvolutionSignal>): Evolution[] {
  const live = groupEvolutions(all, signals).filter((g) => g.key !== "legacy" && !TERMINAL.has(g.key as Evolution["state"])).flatMap((g) => g.items);
  return ORDER.flatMap((state) => live.filter((e) => e.state === state));
}
