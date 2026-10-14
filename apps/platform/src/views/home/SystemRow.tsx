import { useId } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui";
import { StatusText } from "@/components/StatusText/StatusText";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { shortRev } from "@/model/revisions";
import { relTime } from "@/model/time";
import { cardSummary, type CardSummary } from "./signifiers";
import styles from "./home.module.css";

/** Column labels above the Systems register; shown from 900px, where the rows align to them. */
export function SystemsHeader() {
  return (
    <div className={`${styles.regHead} ${styles.systemCols}`} aria-hidden="true">
      <span>Name</span><span>Status</span><span>Deploy</span><span>Head</span><span>Updated</span><span />
    </div>
  );
}

/**
 * One System in the Systems register: the whole row opens its environment; "Describe a change" sits after it, outside
 * the link. The link is named by the System title (its cells describe it).
 */
export function SystemRow({ system, now }: { system: CardSummary; now: number }) {
  const { headline, state, tone, deploy } = cardSummary(system);
  const name = system.title || system.systemId;
  const base = `/s/${encodeURIComponent(system.systemId)}`;
  const nameId = useId();
  const status = tone === "quiet" || tone === "unbuilt"
    ? <StatusText status={tone} label={headline} tone="neutral" glyph={tone === "quiet" ? "" : "○"} />
    : <StatusText status={tone} label={headline} tone={tone === "attention" ? "attention" : "neutral"} glyph={tone === "evolving" ? "◐" : undefined} />;
  return (
    <li className={`${styles.regRow} ${styles.systemCols}`}>
      <Link to={base} className={`u-selectable ${styles.regLink}`} data-state={state === "quiet" ? undefined : state} aria-labelledby={nameId}>
        <span className={styles.cellName}>
          <span id={nameId} className={styles.rowTitle}>{name}</span>
          <MetaLine items={[{ value: system.systemId, code: true }, { label: "Phase", value: system.phase ?? "unknown" }]} />
        </span>
        <span className={`${styles.cell} ${styles.cellStatus}`}>{status}</span>
        <span className={styles.cell}>
          <StatusText status={deploy.status} label={deploy.label} tone={deploy.tone} glyph={deploy.glyph} title={deploy.title} />
          {deploy.build && <StatusText status={deploy.build.status} label={deploy.build.label} tone={deploy.build.tone} title={deploy.build.title} />}
        </span>
        <span className={styles.cell}><span className={styles.cellLabel}>Head </span><code>{system.head ? shortRev(system.head) : "unknown"}</code></span>
        <span className={styles.cell} title={system.updatedAt || undefined}><span className={styles.cellLabel}>Updated </span>{system.updatedAt ? relTime(system.updatedAt, now) : "unknown"}</span>
      </Link>
      <span className={styles.regAction}>
        <Button asChild size="compact">
          <Link to={`${base}/r/head/work?panel=intent`} aria-label={`Describe a change to ${name}`}>Describe a change</Link>
        </Button>
      </span>
    </li>
  );
}
