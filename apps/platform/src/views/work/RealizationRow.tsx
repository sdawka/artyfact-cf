import { memo } from "react";
import { Link } from "react-router";
import type { Candidate, ConflictReport, Realization } from "../../../shared/api";
import { MetaLine, type MetaItem } from "@/components/MetaLine/MetaLine";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusText } from "@/components/StatusText/StatusText";
import type { ChipTone } from "@/components/StatusChip/StatusChip";
import { useKeepParams } from "@/model/useSelection";
import { BuildChip } from "./BuildChip";
import { ConflictChips } from "./ConflictChips";
import { countdown, countdownTone, relTime, shortSha } from "./lib";
import styles from "./work.module.css";

/** Status tones from `component.work.signifiers`: a submitted or evaluated attempt waits on a person; rejected is danger. */
const TONE: Partial<Record<string, ChipTone>> = { submitted: "attention", evaluated: "attention", "awaiting-admin": "attention", rejected: "fail", failed: "fail" };
const LIVE = new Set(["running", "started", "working", "claimed"]);

interface Props {
  realization: Realization;
  candidate?: Candidate | undefined;
  conflicts: readonly ConflictReport[];
  /** Coarse clock; rows re-render when the minute changes, not on every refetch. */
  now: number;
}

/**
 * One agent's attempt at an Evolution: agent, role, target and status, then fork, last checkpoint, token countdown,
 * build and conflicts (naming the other party). The decision lives on Review: "Open in Review".
 * Memoised so a refetch with equal data leaves the DOM untouched.
 */
export const RealizationRow = memo(function RealizationRow({ realization: r, candidate, conflicts, now }: Props) {
  const href = useKeepParams();
  const last = r.checkpoints.at(-1);
  const subjects = (candidate?.changedSubjects ?? []).filter((s) => !s.startsWith("unmapped:"));
  const sha = last?.commit ?? r.workspace.baseCommit;
  const expires = r.workspace.tokenExpiresAt;
  const meta: MetaItem[] = [
    { label: "fork", value: r.workspace.fork, code: true },
    { label: "at", value: shortSha(sha), code: true, ...(sha && { title: sha }) },
    { label: "checkpoint", value: last ? <>{last.summary} <span title={last.at}>{relTime(last.at, now)}</span></> : "unknown" },
  ];
  const tokenTone = countdownTone(expires, now);
  return (
    <li className={styles.attempt} data-status={r.status} data-testid={`realization-${r.id}`}>
      <div className={styles.attemptHead}>
        <span className={styles.agent}>{r.agent.id}</span>
        <MetaLine items={[{ value: r.agent.role }, { value: r.target }]} />
        <StatusText status={r.status} tone={TONE[r.status] ?? "neutral"} glyph={LIVE.has(r.status) ? "◑" : undefined} />
        <Link className={styles.next} to={href("review", { evolution: r.evolution, realization: r.id, panel: null })}>
          Open in Review <span className="sr-only">{r.id}</span>
        </Link>
      </div>
      <MetaLine items={meta} />
      {(expires || candidate) && (
        <div className={styles.attemptFacts}>
          {expires && (
            <span className={styles.token} data-tone={tokenTone}>
              {countdown(expires, now) === "expired" ? "token expired" : <>token expires in <span className="u-numeric">{countdown(expires, now)}</span></>}
            </span>
          )}
          {candidate && <BuildChip build={candidate.build} variant="text" />}
        </div>
      )}
      {subjects.length > 0 && (
        <ul className={styles.chips} aria-label="Changed subjects">
          {subjects.map((s) => <li key={s}><NodeChip id={s} size="sm" /></li>)}
        </ul>
      )}
      <ConflictChips conflicts={conflicts} {...(candidate && { self: candidate.id })} />
    </li>
  );
});
