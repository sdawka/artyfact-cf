import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { Button } from "@/components/ui";
import { useKeepParams } from "@/model/useSelection";
import type { Evolution } from "../../../shared/api";
import { useWorkData } from "../work/data";
import { groupEvolutions } from "../work/EvolutionGroups";
import { TERMINAL } from "../work/lib";
import { useEvolutionSignals, type EvolutionSignal } from "../work/useEvolutionSignals";
import styles from "./Overview.module.css";

/** Active states, nearest to done first. promoted, rejected and withdrawn are finished, not active. */
const ORDER = ["actionable", "realizing", "evaluated", "genome-approved", "proposed"];
const LIMIT = 5;
/** Narrow screens show this many rows; "All Evolutions" has the rest. */
const NARROW_LIMIT = 3;

/**
 * The Evolutions Work groups under an unfinished state, by Work's own classifier: Legacy (read-only history) and the
 * terminal groups are left out, so Overview and Work agree on what is active and in which state.
 */
export function activeEvolutions(all: readonly Evolution[], signals: ReadonlyMap<string, EvolutionSignal>): Evolution[] {
  const live = groupEvolutions(all, signals).filter((g) => g.key !== "legacy" && !TERMINAL.has(g.key as Evolution["state"])).flatMap((g) => g.items);
  return ORDER.flatMap((state) => live.filter((e) => e.state === state));
}

/** The first five active Evolutions as rows into Work, then a link to all of them. */
export function ActiveEvolutionsCard() {
  const href = useKeepParams();
  // The same Evolutions and signals Work groups: the live board over the Genome's declared ones.
  const { evolutions: all } = useWorkData();
  const { signals } = useEvolutionSignals();
  const active = activeEvolutions(all, signals);
  const shown = active.slice(0, LIMIT);
  return (
    <Section title="Active Evolutions" count={active.length}>
      {active.length === 0 ? (
        <EmptyState
          title={all.length ? "No active Evolutions." : "No Evolutions yet."}
          action={<Button asChild><Link to={href("work", { panel: "intent" })}>Describe a change</Link></Button>}
        >
          {all.length ? <>Finished and legacy Evolutions are in <Link to={href("work")}>Work</Link>.</> : "A change starts as an Evolution."}
        </EmptyState>
      ) : (
        <>
          <RowList label="Active Evolutions">
            {shown.map((e, i) => (
              <Row
                key={e.id}
                className={i >= NARROW_LIMIT ? styles.wideOnly : undefined}
                to={href("work", { evolution: e.id })}
                title={e.title}
                status={<StatusText status={e.state} />}
                meta={<MetaLine items={[
                  { value: e.id, code: true },
                  ...(e.kind !== "genome-amendment" ? [{ value: `legacy ${e.kind}` }] : []),
                  { value: `${e.risk} risk` },
                  { value: `${e.affectedNodes.length} ${e.affectedNodes.length === 1 ? "node" : "nodes"}` },
                ]} />}
              />
            ))}
          </RowList>
          <Link className={styles.allLink} to={href("work")}>All Evolutions <span className="u-numeric">({all.length})</span></Link>
        </>
      )}
    </Section>
  );
}
