import { Link } from "react-router";
import { useEvolutions } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useKeepParams } from "@/model/useSelection";
import { registerBody, type BodyProps } from "./registry";
import styles from "../Inspector.module.css";

/** Realizations are not in the model index; this resolves the id against the live board. */
function RealizationBody({ entry }: BodyProps) {
  const href = useKeepParams();
  const { data } = useEvolutions();
  const r = data?.realizations.find((x) => x.id === entry.id);
  if (!r) return <EmptyState title={`Realization ${entry.id} is not on the board.`} />;
  const last = r.checkpoints.at(-1);
  return (
    <div className={styles.stack}>
      <div className={styles.row}><div className={styles.rowLabel}>Agent</div><div>{r.agent.id} · {r.agent.role}</div></div>
      <div className={styles.row}><div className={styles.rowLabel}>Evolution</div><NodeChip id={r.evolution} size="sm" /></div>
      <div className={styles.row}><div className={styles.rowLabel}>Status</div><div>{r.status} · target {r.target}</div></div>
      <div className={styles.row}><div className={styles.rowLabel}>Fork</div><div><code>{r.workspace.fork}</code> at <code>{(last?.commit ?? r.workspace.baseCommit).slice(0, 7)}</code></div></div>
      <div className={styles.row}><div className={styles.rowLabel}>Last checkpoint</div><div>{last ? `${last.summary} (${last.at})` : "unknown"}</div></div>
      <Link to={href("work", { evolution: r.evolution, realization: r.id })} className="u-marker">Open in Work</Link>
    </div>
  );
}

registerBody("realization", RealizationBody);
