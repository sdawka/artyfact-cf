import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import type { ChangelogRow } from "../../../shared/api";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { StatusText } from "@/components/StatusText/StatusText";
import { buildTone } from "@/components/StatusChip/StatusChip";
import { FAKE_PROVIDER_TITLE } from "@/model/provider";
import { shortRev } from "@/model/revisions";
import { relTime } from "@/model/time";
import { LEGACY_NOTICE } from "@/views/compare/legacy";
import { CommitDetail } from "./CommitDetail";
import { summaryLine } from "./summary";
import styles from "./changelog.module.css";

interface Props {
  row: ChangelogRow;
  expanded: boolean;
  current: boolean;
  now: number;
  onToggle(): void;
}

/** The one state a row shows: the deployment when there is one, else the newest build. */
function RowStatus({ row }: { row: ChangelogRow }) {
  const d = row.deployment;
  if (d) return <StatusText status={d.status} label={`${d.kind} ${d.status}`} tone={d.status === "failed" ? "fail" : "neutral"} />;
  const b = row.builds[0];
  return b ? <StatusText status={b.status} label={`${b.kind} build ${b.status}`} tone={buildTone(b.status)} /> : null;
}

/**
 * One System commit as a divided row of three lines: id, time and author; the rationale in full; the summary with at most
 * one state. The whole row toggles its detail; Copy sits beside it.
 */
export function CommitRow({ row, expanded, current, now, onToggle }: Props) {
  const detailId = `commit-detail-${row.id}`;
  const Caret = expanded ? ChevronDownIcon : ChevronRightIcon;
  const evolutions = row.evolutions.map((e) => e.title || e.id);
  return (
    <li id={`commit-${row.id}`} className={`${styles.row} ${current ? "u-selected" : ""}`} data-current={current || undefined} {...(current && { "aria-current": "true" as const })}>
      <div className={styles.rowHead}>
        <button
          type="button"
          className={`u-selectable ${styles.toggle}`}
          aria-expanded={expanded}
          aria-controls={expanded ? detailId : undefined}
          onClick={onToggle}
        >
          <span className={styles.line}>
            <Caret aria-hidden="true" className={styles.caret} />
            <code className={styles.id}>{shortRev(row.id)}</code>
            <time className="u-numeric" dateTime={row.at} title={row.at}>{relTime(row.at, now)}</time>
            <span className={styles.by} title={row.policy}>by {row.by}{row.kind !== "promotion" ? `, ${row.kind}` : ""}</span>
          </span>
          <span className={styles.rationale}>{row.rationale || "No rationale recorded."}</span>
          <span className={`${styles.line} ${styles.meta}`}>
            <span>{row.loadError ? "summary unknown" : summaryLine(row.summary)}</span>
            {evolutions.length > 0 && <span title={row.evolutions.map((e) => e.id).join(", ")}>Evolution {evolutions.join(", ")}</span>}
            <RowStatus row={row} />
            {row.rationalePending && <StatusText status="pending" label="Rationale pending" tone="attention" />}
            {row.legacyFormat && <span>{LEGACY_NOTICE}</span>}
            {row.fakeProvider && <span title={FAKE_PROVIDER_TITLE}>System One: fake provider</span>}
          </span>
        </button>
        <span className={styles.copy}><CopyButton value={row.id} label="Copy commit id" /></span>
      </div>
      {expanded && <CommitDetail id={detailId} row={row} />}
    </li>
  );
}
