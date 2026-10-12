import { Link } from "react-router";
import { useEvolutions } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import type { Evolution } from "../../../shared/api";
import styles from "./Overview.module.css";

const ORDER = ["actionable", "realizing", "evaluated", "genome-approved", "proposed", "promoted", "rejected", "withdrawn"];
const ACTIVE_LIMIT = 3;

/** Evolutions grouped by state, each with scope chips and a link to the Work board. */
export function ActiveEvolutionsCard() {
  const m = useModel();
  const href = useKeepParams();
  const { data } = useEvolutions();
  // The live board wins; before the API has any, the Genome's own Evolutions show their declared state.
  const live = data?.evolutions ?? [];
  const evolutions: Evolution[] = live.length ? live : (m.index.model.evolutions ?? []);
  const groups = ORDER.map((state) => [state, evolutions.filter((e) => e.state === state)] as const).filter(([, xs]) => xs.length);

  return (
    <section className={styles.card} aria-labelledby="evolutions-title">
      <h2 id="evolutions-title" className={styles.cardTitle}>Evolutions</h2>
      {!groups.length ? (
        <p className={styles.muted}>No Evolutions.</p>
      ) : (
        <div className={styles.evoGroups}>
          {groups.map(([state, xs]) => (
            <div key={state} className={styles.evoGroup}>
              <h3 className={styles.blockTitle}>{state} <span className={styles.count}>{xs.length}</span></h3>
              <ul className={styles.plain}>
                {xs.map((e) => (
                  <li key={e.id} className={styles.evo}>
                    <Link className="u-marker" to={href("work", { evolution: e.id })}>{e.title}</Link>
                    <span className={styles.muted}> {e.id} · {e.kind} · {e.risk} risk</span>
                    <ul className={styles.chips} aria-label={`Scope of ${e.title}`}>
                      {e.affectedNodes.slice(0, ACTIVE_LIMIT).map((n) => <li key={n}><NodeChip id={n} size="sm" /></li>)}
                      {e.affectedNodes.length > ACTIVE_LIMIT && (
                        <li className={styles.muted}>+{e.affectedNodes.length - ACTIVE_LIMIT} more</li>
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
