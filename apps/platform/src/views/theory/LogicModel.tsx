import { useMemo, useRef, type CSSProperties } from "react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { Purpose, TheoryClaim } from "@/model/types";
import { StatusText } from "@/components/StatusText/StatusText";
import { ClaimStatus } from "./ClaimStatus";
import { Links, type LinkSpec } from "./Links";
import styles from "./LogicModel.module.css";

const COLUMNS = ["Purpose", "Beneficiaries", "Activities", "Outputs", "Outcomes"] as const;

/** An empty cell is quiet text, not a card. */
function Chips({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return <span className={styles.none}>none stated</span>;
  return <span className={styles.chips}>{ids.map((id) => <NodeChip key={id} id={id} size="sm" />)}</span>;
}

/** The four hand-offs drawn for one claim row: purpose → beneficiaries → activities → outputs → outcomes. */
export function rowLinks(claim: TheoryClaim): LinkSpec[] {
  const cells = [`purpose:${claim.purpose}`, `${claim.id}:ben`, `${claim.id}:act`, `${claim.id}:out`, `${claim.id}:res`];
  return cells.slice(1).map((to, i) => ({ id: `${claim.id}:${i}`, from: cells[i]!, to }));
}

export interface LogicModelProps {
  purposes: readonly Purpose[];
  claims: readonly TheoryClaim[];
}

/** Five-column logic model, one row per claim. Purposes span the rows of their claims. */
export function LogicModel({ purposes, claims }: LogicModelProps) {
  const grid = useRef<HTMLDivElement>(null);
  const links = useMemo(() => claims.flatMap(rowLinks), [claims]);
  // Grid row 1 is the header; claim rows start at 2.
  const spans = useMemo(
    () =>
      purposes.flatMap((p) => {
        const rows = claims.flatMap((c, i) => (c.purpose === p.id ? [i + 2] : []));
        return rows.length ? [{ purpose: p, start: Math.min(...rows), end: Math.max(...rows) + 1 }] : [];
      }),
    [purposes, claims],
  );

  // The Purpose column is dropped when no claim points at a purpose.
  const shift = spans.length ? 0 : 1;
  return (
    <div ref={grid} className={styles.grid} role="group" aria-label="Logic model" style={{ "--cols": COLUMNS.length - shift } as CSSProperties}>
      <div className={styles.headRow}>
        {COLUMNS.slice(shift).map((c, i) => (
          <div key={c} className={styles.head} style={{ gridColumn: i + 1, gridRow: 1 }}>
            {c}
          </div>
        ))}
      </div>
      {spans.map(({ purpose, start, end }) => (
        <div
          key={purpose.id}
          data-cell={`purpose:${purpose.id}`}
          className={`${styles.cell} ${styles.purpose}`}
          style={{ gridColumn: 1, gridRow: `${start} / ${end}` }}
        >
          <NodeChip id={purpose.id} size="sm" />
          <p className={styles.statement}>{purpose.statement}</p>
          <p className={styles.label}>Success criteria</p>
          <ul className={styles.list}>
            {purpose.successCriteria.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ))}
      {claims.map((c, i) => {
        const row = i + 2;
        const cell = (col: number, key: string) => ({ "data-cell": `${c.id}:${key}`, style: { gridColumn: col - shift, gridRow: row } });
        return (
          <div key={c.id} className={styles.row} data-claim={c.id} data-deferred={c.deferred || undefined}>
            <div className={styles.cell} data-empty={c.beneficiaries.length ? undefined : ""} {...cell(2, "ben")}>
              <Chips ids={c.beneficiaries} />
            </div>
            <div className={styles.cell} data-empty={c.activities.length ? undefined : ""} {...cell(3, "act")}>
              <Chips ids={c.activities} />
            </div>
            <div className={styles.cell} {...cell(4, "out")}>
              <span className={styles.titleLine}>
                <NodeChip id={c.id} size="sm" />
                {c.deferred && <StatusText status="deferred" />}
              </span>
              <p className={styles.text}>{c.mechanism}</p>
            </div>
            <div className={styles.cell} {...cell(5, "res")}>
              <p className={styles.text}>{c.outcome}</p>
              <p className={styles.meta}>
                <span className={styles.label}>Indicator </span>
                {c.indicator}
              </p>
              <details className={styles.method}>
                <summary>Evaluation method</summary>
                <p className={styles.meta}>{c.evaluationMethod}</p>
              </details>
              <ClaimStatus status={c.status} />
            </div>
          </div>
        );
      })}
      <Links containerRef={grid} links={links} />
    </div>
  );
}
