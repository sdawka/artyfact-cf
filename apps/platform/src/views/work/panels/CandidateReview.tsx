import { Button } from "@/components/ui";
import { lazy, Suspense, useMemo, useState } from "react";
import type { Candidate, Evaluation, Evolution, Realization } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { ApiRequestError } from "@/api/client";
import { useEvaluateCandidate, useHistory } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { MetaLine, type MetaItem } from "@/components/MetaLine/MetaLine";
import { KindGlyphs, NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { Tabs } from "@/components/Tabs/Tabs";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { verdictOf as verdictFor, type UiVerdict } from "@/model/status";
import { useModel } from "@/model/useModel";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import { EvaluationsTable } from "../../evaluations/EvaluationsTable";
import { behindBy } from "../../review/queue";
import { headOf } from "../gates";
import { aggregate, subjectGroups } from "../lib";
import { DecisionHead } from "./DecisionHead";
import { verdictCounts, VerdictSummary } from "./VerdictSummary";
import styles from "./decision.module.css";

type Tab = "delta" | "files" | "evals" | "amendment";

const AmendmentReview = lazy(() => import("./AmendmentReview"));

interface Props {
  realization: Realization;
  candidate: Candidate | undefined;
  evolution: Evolution;
  /** Focus the h2 on open (Review passes false when it opened the first decision by itself). */
  autoFocus?: boolean;
}

/** One verdict per criterion the candidate was evaluated on (every hook folded, like the gates). */
function criterionVerdicts(evaluations: readonly Evaluation[], candidateId: string): UiVerdict[] {
  const own = evaluations.filter((e) => e.candidate === candidateId);
  const scope = { source: "selected" as const, candidates: [candidateId] };
  return [...new Set(own.map((e) => e.criterion))].map((c) => verdictFor(c, own, scope));
}

/**
 * Review of one realization's candidate: h2 is the Evolution, the status its verdict summary, then the semantic delta,
 * files, evaluations and (genome target) the amendment.
 */
export function CandidateReview({ realization, candidate, evolution, autoFocus = false }: Props) {
  const [tab, setTab] = useState<Tab>("delta");
  const { candidates: selected, setCandidates } = useSelection();
  const { systemId } = useSystemRoute();
  const m = useModel();
  const { data: commits } = useHistory();
  const verdicts = useMemo(() => (candidate ? criterionVerdicts(m.evaluations, candidate.id) : []), [m.evaluations, candidate]);
  const evalLabel = verdicts.length ? `Evaluations ${verdictCounts(verdicts).map(([v, n]) => `${n} ${v}`).join(" · ")}` : "Evaluations";
  const tabs = [
    { id: "delta" as const, label: "Semantic delta" },
    { id: "files" as const, label: "Files" },
    { id: "evals" as const, label: evalLabel },
    ...(realization.target === "genome" ? [{ id: "amendment" as const, label: "Amendment" }] : []),
  ];
  if (!candidate) {
    return (
      <section className={styles.pane} aria-label={`Review ${realization.id}`}>
        <DecisionHead title={evolution.title} autoFocus={autoFocus} meta={<MetaLine items={[{ label: "realization", value: realization.id, code: true }, { label: "agent", value: realization.agent.id }]} />} />
        <EmptyState title="No candidate yet. The agent has not submitted, so there is nothing to review." />
        <Checkpoints realization={realization} />
      </section>
    );
  }
  const isSelected = selected.includes(candidate.id);
  const toggle = () => setCandidates(isSelected ? selected.filter((c) => c !== candidate.id) : [...selected, candidate.id]);
  const head = headOf(commits);
  const behind = behindBy(candidate.baseRevision, head, commits);
  const build = candidate.build;
  const meta: MetaItem[] = [
    ...(behind !== undefined && behind !== 0 ? [{ value: <StatusText status="behind" tone="attention" glyph="↻" label={behind === null ? "behind head" : `behind by ${behind}`} /> }] : []),
    { label: "candidate", value: candidate.id, code: true },
    { label: "agent", value: `${realization.agent.id} ${realization.agent.role}` },
    { label: "state", value: candidate.state },
    { label: "base", value: <><code>{candidate.baseRevision ?? "none"}</code>{behind === 0 && " = head"}</> },
    { label: "build", value: <>{build?.status ?? "unknown"}{build?.url && <> <a href={build.url} target="_blank" rel="noopener noreferrer">Preview</a></>}</> },
  ];
  return (
    <section className={styles.pane} aria-label={`Review ${realization.id}`}>
      <DecisionHead
        title={evolution.title}
        autoFocus={autoFocus}
        status={verdicts.length ? <VerdictSummary verdicts={verdicts} /> : undefined}
        meta={<MetaLine items={meta} />}
        secondary={
          <>
            {/* A Genome amendment is accepted or rejected, never promoted. */}
            {realization.target !== "genome" && <Button type="button" variant="secondary" aria-pressed={isSelected} onClick={toggle}>Add to promotion</Button>}
            <RerunChecks candidate={candidate} />
          </>
        }
      />
      <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} label="Candidate review sections">
        {tab === "delta" && <SemanticDelta candidate={candidate} />}
        {tab === "files" && <Files candidate={candidate} />}
        {tab === "evals" && <CandidateEvaluations candidate={candidate} />}
        {tab === "amendment" &&
          <Suspense fallback={<p role="status">Loading amendment…</p>}>
            <AmendmentReview systemId={systemId} evolutionId={evolution.id} realization={realization} candidate={candidate} />
          </Suspense>}
      </Tabs>
    </section>
  );
}

function rerunError(err: Error): string {
  if (err instanceof ApiRequestError && err.status === 401) return "Re-run checks needs the admin token (401). Set it in the header and try again.";
  if (err instanceof ApiRequestError && err.status === 403) return "The admin token was refused (403). Check it in the header and try again.";
  return err.message;
}

/** Admin: re-run the candidate's submission hooks against its current preview (e.g. after a deploy race). */
function RerunChecks({ candidate }: { candidate: Candidate }) {
  const m = useModel();
  const { token } = useAdminToken();
  const rerun = useEvaluateCandidate();
  const reason = m.bundle.source === "fixture"
    ? "Re-run checks needs the platform API. The UI is showing fixture data."
    : candidate.state === "promoted" || candidate.state === "rejected"
      ? `${candidate.id} is ${candidate.state}; its checks are final.`
      : undefined;
  const ran = rerun.isSuccess && rerun.variables?.candidateId === candidate.id ? rerun.data : null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        reason={reason}
        disabled={rerun.isPending}
        onClick={() => rerun.mutate({ candidateId: candidate.id, ...(token && { adminToken: token }) })}
      >
        {rerun.isPending ? "Re-running checks…" : "Re-run checks"}
      </Button>
      {ran && <span role="status" className={styles.note}>Checks re-run: {ran.evaluations.length} evaluation{ran.evaluations.length === 1 ? "" : "s"} recorded.</span>}
      {rerun.isError && <span role="alert" className={styles.error}>{rerunError(rerun.error)}</span>}
    </>
  );
}

function Checkpoints({ realization }: { realization: Realization }) {
  if (!realization.checkpoints.length) return null;
  return (
    <ul className={styles.rows} aria-label="Checkpoints">
      {realization.checkpoints.map((c, i) => <li key={i}><span>{c.summary}</span> <span className={styles.note} title={c.at}>{c.at}</span></li>)}
    </ul>
  );
}

function SubjectGroup({ title, ids }: { title: string; ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <ul className={styles.chips}>{ids.map((id) => <li key={id}><NodeChip id={id} size="sm" /></li>)}</ul>
    </div>
  );
}

function SemanticDelta({ candidate }: { candidate: Candidate }) {
  const m = useModel();
  const g = subjectGroups(candidate);
  const all = [...g.added, ...g.changed, ...g.removed];
  const { criteria, journeys } = useMemo(() => {
    const ids = new Set(all.flatMap((s) => m.descendants(s)));
    const cs = new Map<string, string>();
    const js = new Set<string>();
    for (const id of ids) {
      for (const c of m.criteriaFor(id)) cs.set(c.id, c.id);
      for (const j of m.journeysFor(id)) js.add(j.id);
    }
    return { criteria: [...cs.keys()], journeys: [...js] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, candidate.changedSubjects, candidate.subjectDelta]);
  const evals = m.evaluations.filter((e) => e.candidate === candidate.id);
  const own = { source: "selected" as const, candidates: [candidate.id] };
  if (!all.length && !g.unmapped.length && !candidate.genomeChanges?.length) {
    return <EmptyState title="No changed subjects recorded for this candidate." />;
  }
  return (
    <div className={styles.groups}>
      <SubjectGroup title="Added" ids={g.added} />
      <SubjectGroup title={g.unknownOp ? "Changed (operation unknown)" : "Changed"} ids={g.changed} />
      <SubjectGroup title="Removed" ids={g.removed} />
      {g.unmapped.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Unmapped</h3>
          <p className={styles.hint}>These changes could not be tied to a model node.</p>
          <ul className={styles.rows}>{g.unmapped.map((s) => <li key={s}><code>{s.replace(/^unmapped:/, "")}</code></li>)}</ul>
        </div>
      )}
      {candidate.genomeChanges?.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Genome changes</h3>
          <ul className={styles.rows}>{candidate.genomeChanges.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {criteria.length ? (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Affected criteria</h3>
          {/* A verdict sits in each row: the criterion kind glyph (✓) would read as a pass. */}
          <KindGlyphs hidden>
            <ul className={styles.rows}>
              {criteria.map((c) => {
                const v = aggregate([verdictFor(c, evals, own)]);
                return <li key={c}><NodeChip id={c} size="sm" glyph={false} /><VerdictBadge verdict={v} /></li>;
              })}
            </ul>
          </KindGlyphs>
        </div>
      ) : <p className={styles.muted}>No criteria are affected.</p>}
      {journeys.length ? (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Affected journeys</h3>
          <ul className={styles.chips}>{journeys.map((j) => <li key={j}><NodeChip id={j} size="sm" /></li>)}</ul>
        </div>
      ) : <p className={styles.muted}>No journeys are affected.</p>}
    </div>
  );
}

function Files({ candidate }: { candidate: Candidate }) {
  const unmapped = new Set((candidate.changedSubjects ?? []).filter((s) => s.startsWith("unmapped:")).map((s) => s.slice("unmapped:".length)));
  const paths = candidate.changedPaths ?? [];
  if (!paths.length) return <EmptyState title="No changed files recorded for this candidate." />;
  return (
    <ul className={styles.rows} aria-label="Changed files">
      {paths.map((p) => (
        <li key={p}>
          <code>{p}</code>
          {unmapped.has(p) && <span className={styles.unmapped}>unmapped</span>}
        </li>
      ))}
    </ul>
  );
}

function CandidateEvaluations({ candidate }: { candidate: Candidate }) {
  const m = useModel();
  const rows = useMemo(() => m.evaluations.filter((e) => e.candidate === candidate.id), [m.evaluations, candidate.id]);
  return <EvaluationsTable evaluations={rows} compact emptyTitle="No evaluations yet for this candidate." emptyHint="They are recorded when it is submitted or its checks are re-run." />;
}
