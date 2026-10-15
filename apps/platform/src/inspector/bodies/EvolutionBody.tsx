import { Link } from "react-router";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import type { Evolution } from "../../../shared/api";
import { groupByLayer, layerFromModel } from "@/model/layers";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { registerBody, type BodyProps } from "./registry";
import styles from "../Inspector.module.css";

function Chips({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return <span className={styles.muted}>none</span>;
  return <ul className={styles.chips}>{ids.map((id) => <li key={id}><NodeChip id={id} size="sm" /></li>)}</ul>;
}

function EvolutionBody({ entry }: BodyProps) {
  const e = entry.item as Evolution;
  const m = useModel();
  const href = useKeepParams();
  return (
    <div className={styles.stack}>
      <p>{e.intent}</p>
      <div className={styles.row}><div className={styles.rowLabel}>State</div><div>{e.state} · {e.kind} · risk {e.risk}</div></div>
      <div className={styles.row}><div className={styles.rowLabel}>Affected</div><Chips ids={e.affectedNodes} /></div>
      <div className={styles.row}>
        <div className={styles.rowLabel}>Acceptance criteria</div>
        {e.acceptanceCriteria.length ? (
          <ul className={styles.plain}>
            {groupByLayer(e.acceptanceCriteria, (c) => layerFromModel(m, c)).map((g) => (
              <li key={g.layer} data-layer={g.layer}>
                <span className={styles.muted}>{g.label}</span>
                <ul className={styles.plain}>
                  {g.items.map((c) => <li key={c} className={styles.cardHead}><NodeChip id={c} size="sm" glyph={false} /><VerdictBadge verdict={m.verdictOf(c)} /></li>)}
                </ul>
              </li>
            ))}
          </ul>
        ) : <span className={styles.muted}>none</span>}
      </div>
      <div className={styles.row}><div className={styles.rowLabel}>Depends on</div><Chips ids={e.dependsOn} /></div>
      {e.genomeDelta.length > 0 && (
        <div className={styles.row}>
          <div className={styles.rowLabel}>Genome delta</div>
          <ul className={styles.plain}>{e.genomeDelta.map((d) => <li key={`${d.op}-${d.path}`}>{d.op} <code>{d.path}</code>: {d.summary}</li>)}</ul>
        </div>
      )}
      {e.decision && <div className={styles.row}><div className={styles.rowLabel}>Decision</div><div>{e.decision}</div></div>}
      <Link to={href("work", { evolution: e.id })} className="u-marker">Open in Work</Link>
    </div>
  );
}

registerBody("evolution", EvolutionBody);
