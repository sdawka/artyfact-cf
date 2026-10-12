import { Link } from "react-router";
import { useRealizationsTouching } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import styles from "./Inspector.module.css";

/** Evolutions that touch the node, and the realizations working on them with their status. */
export function ChangesTab({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const href = useKeepParams();
  const { data: realizations, isLoading } = useRealizationsTouching(entry.id);
  const evolutions = (m.index.model.evolutions ?? []).filter((e) => e.affectedNodes.includes(entry.id));
  if (!evolutions.length && !realizations.length) {
    return <EmptyState title={isLoading ? "Loading changes…" : "No evolutions touch this object."} />;
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <div className={styles.rowLabel}>Evolutions</div>
        <ul className={styles.plain}>
          {evolutions.map((e) => (
            <li key={e.id} className={styles.cardHead}>
              <NodeChip id={e.id} size="sm" />
              <span className={styles.muted}>{e.state}</span>
              <Link to={href("work", { evolution: e.id })} className="u-marker">Open in Work</Link>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>Realizations</div>
        {realizations.length ? (
          <ul className={styles.plain}>
            {realizations.map((r) => (
              <li key={r.id} className={styles.cardHead}>
                <Link to={href("work", { evolution: r.evolution, realization: r.id })} className="u-marker">{r.id}</Link>
                <span>{r.agent.id}</span>
                <span className={styles.muted}>{r.target} · {r.status}{r.candidate ? ` · candidate ${r.candidate}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={styles.muted}>none</span>
        )}
      </div>
    </div>
  );
}

