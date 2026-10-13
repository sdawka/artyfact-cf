import type { ChangelogRow } from "../../../shared/api";
import { StatePill } from "@/app/StatePill";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { StatusChip, buildTone } from "@/components/StatusChip/StatusChip";
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

/** One System commit: a single expand button over a dense summary line, the copy button beside it, the detail below. */
export function CommitRow({ row, expanded, current, now, onToggle }: Props) {
  const detailId = `commit-detail-${row.id}`;
  const build = row.builds[0];
  return (
    <li id={`commit-${row.id}`} className={styles.row} data-current={current || undefined} {...(current && { "aria-current": "true" as const })}>
      <div className={styles.rowHead}>
        <button
          type="button"
          className={`u-brackets ${styles.toggle}`}
          aria-expanded={expanded}
          aria-controls={expanded ? detailId : undefined}
          onClick={onToggle}
        >
          <span className={styles.line}>
            <span aria-hidden="true" className={styles.caret}>{expanded ? "▾" : "▸"}</span>
            <code className={styles.id}>{shortRev(row.id)}</code>
            <time dateTime={row.at} title={row.at}>{relTime(row.at, now)}</time>
            <span className={styles.muted}>{row.by} · {row.policy}{row.kind !== "promotion" ? ` · ${row.kind}` : ""}</span>
            {row.evolutions.map((e) => (
              <span key={e.id} className={styles.evo} title={e.id}>{e.title || e.id}</span>
            ))}
          </span>
          <span className={styles.line}>
            <span className={styles.rationale}>{row.rationale || "No rationale recorded."}</span>
          </span>
          <span className={styles.line}>
            <span className={styles.summary}>{row.loadError ? "summary unknown" : summaryLine(row.summary)}</span>
            {row.legacyFormat && <span className={styles.muted}>{LEGACY_NOTICE}</span>}
            {row.fakeProvider && <StatePill state="fake" title={FAKE_PROVIDER_TITLE}>System One: fake provider</StatePill>}
            {row.rationalePending && <StatusChip status="pending" label="rationale pending" tone="attention" />}
            {build && <StatusChip status={build.status} label={`${build.kind} build ${build.status}`} tone={buildTone(build.status)} />}
            {row.deployment && (
              <StatusChip status={row.deployment.status} label={`${row.deployment.kind} ${row.deployment.status}`} tone={row.deployment.status === "failed" ? "fail" : "neutral"} />
            )}
          </span>
        </button>
        <CopyButton value={row.id} label="Copy commit id" />
      </div>
      {expanded && <CommitDetail id={detailId} row={row} />}
    </li>
  );
}
