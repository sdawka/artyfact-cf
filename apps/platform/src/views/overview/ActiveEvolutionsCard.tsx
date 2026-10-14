import { Link } from "react-router";
import { useEvolutions } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { Button } from "@/components/ui";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import type { Evolution } from "../../../shared/api";
import styles from "./Overview.module.css";

/** Active states, in the order a change moves through them. promoted, rejected and withdrawn are finished, not active. */
const ORDER = ["actionable", "realizing", "evaluated", "genome-approved", "proposed"];
const LIMIT = 5;
/** Narrow screens show this many rows; "All Evolutions" has the rest. */
const NARROW_LIMIT = 3;

/** The first five active Evolutions as rows into Work, then a link to all of them. */
export function ActiveEvolutionsCard() {
  const m = useModel();
  const href = useKeepParams();
  const { data } = useEvolutions();
  // The live board wins; before the API has any, the Genome's own Evolutions show their declared state.
  const live = data?.evolutions ?? [];
  const all: Evolution[] = live.length ? live : (m.index.model.evolutions ?? []);
  const active = ORDER.flatMap((state) => all.filter((e) => e.state === state));
  const shown = active.slice(0, LIMIT);
  return (
    <Section title="Active Evolutions" count={active.length}>
      {active.length === 0 ? (
        <EmptyState
          title="No Evolutions yet."
          action={<Button asChild><Link to={href("work", { panel: "intent" })}>Describe a change</Link></Button>}
        >
          A change starts as an Evolution.
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
                  { value: e.kind },
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
