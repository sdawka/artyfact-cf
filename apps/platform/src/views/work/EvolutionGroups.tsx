import { Link } from "react-router";
import type { Evolution } from "../../../shared/api";
import { Count } from "@/components/Count/Count";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { useStayHref } from "@/model/useThingFilter";
import type { EvolutionGroup } from "./groups";
import { aggregate, verdictStatus } from "./lib";
import type { EvolutionSignal } from "./useEvolutionSignals";
import styles from "./work.module.css";

/**
 * The Evolutions group of the Work list pane: one disclosure per non-empty state group with its count (open when it
 * holds attention items or the selection; terminal and Legacy groups collapsed), and every empty group on one line.
 */
export function EvolutionGroups({ groups, selectedId, signals, total, titleOf }: {
  groups: readonly EvolutionGroup[];
  selectedId: string | null;
  signals: ReadonlyMap<string, EvolutionSignal>;
  total: number;
  titleOf(id: string): string;
}) {
  const empties = groups.filter((g) => !g.items.length);
  return (
    <Section title="Evolutions" count={total} description="Changes to the Genome, by state.">
      {total === 0 && <p className={styles.listNote}>No Genome Evolutions yet. Describe a change to propose one.</p>}
      {groups.filter((g) => g.items.length).map((g) => {
        const holdsSelection = g.items.some((e) => e.id === selectedId);
        const open = g.attention || holdsSelection || !g.quiet;
        return (
          // Keyed by the default so a selection moving into a collapsed group opens it; a person's toggle holds otherwise.
          <details key={`${g.key}-${open}`} className={styles.stateGroup} open={open} data-group={g.key}>
            <summary>
              {g.label} <Count n={g.items.length} />
              {g.attention && <span className="sr-only">, waits on you</span>}
            </summary>
            <RowList label={`${g.label} Evolutions`}>
              {g.items.map((e) => <EvolutionRow key={e.id} evolution={e} current={e.id === selectedId} signal={signals.get(e.id)} titleOf={titleOf} />)}
            </RowList>
          </details>
        );
      })}
      {empties.length > 0 && (
        <p className={styles.empties}>
          {empties.map((g) => <span key={g.key}>{g.label} <Count n={0} /></span>)}
        </p>
      )}
    </Section>
  );
}

/** One Evolution: the whole row links to `?evolution=`; criteria rollup and dependency as meta; overlap and review as attention. */
function EvolutionRow({ evolution: e, current, signal, titleOf }: { evolution: Evolution; current: boolean; signal?: EvolutionSignal | undefined; titleOf(id: string): string }) {
  const m = useModel();
  const href = useKeepParams();
  // The row stays on Work, so it keeps a lifted Thing filter ("Show all").
  const stay = useStayHref();
  const verdicts = e.acceptanceCriteria.map((c) => m.verdictOf(c));
  const pass = verdicts.filter((v) => v === "pass").length;
  const awaiting = signal?.awaiting ?? 0;
  return (
    <Row
      to={stay("work", { evolution: e.id })}
      current={current}
      className={styles.evoRow}
      title={e.title}
      meta={
        <span className={styles.rowMeta}>
          {signal?.overlap && <StatusText status="overlap" tone="attention" glyph="≈" label="overlap" />}
          {awaiting > 0 && <StatusText status="awaiting" tone="attention" label={`${awaiting} await${awaiting === 1 ? "s" : ""} review`} />}
          <StatusText {...verdictStatus(aggregate(verdicts), `${pass}/${e.acceptanceCriteria.length} pass`)} />
          {e.dependsOn.length > 0 && <span>after {e.dependsOn.map(titleOf).join(", ")}</span>}
          {e.kind !== "genome-amendment" && <span>legacy {e.kind}</span>}
        </span>
      }
      trailing={awaiting > 0 ? (
        <Link to={href("review", { evolution: e.id, realization: signal?.realization ?? null, panel: null })} className={styles.trailingLink}>
          Open in Review <span className="sr-only">{e.title}</span>
        </Link>
      ) : undefined}
    />
  );
}
