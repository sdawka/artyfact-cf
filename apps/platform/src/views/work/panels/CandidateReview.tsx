import { Button } from "@/components/ui";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import type { Candidate, Evolution, Realization } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { ApiRequestError } from "@/api/client";
import { useEvaluateCandidate } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Tabs } from "@/components/Tabs/Tabs";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { verdictOf as verdictFor } from "@/model/status";
import { useModel } from "@/model/useModel";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import { EvaluationsTable } from "../../evaluations/EvaluationsTable";
import { BuildChip } from "../BuildChip";
import { aggregate, subjectGroups } from "../lib";
import styles from "../work.module.css";

type Tab = "delta" | "files" | "evals" | "amendment";

const AmendmentReview = lazy(() => import("./AmendmentReview"));

interface Props {
  realization: Realization;
  candidate: Candidate | undefined;
  evolution: Evolution;
}

/** Review of one realization's candidate: semantic delta, files, evaluations and (genome target) the amendment. */
export function CandidateReview({ realization, candidate, evolution }: Props) {
  const [tab, setTab] = useState<Tab>("delta");
  const { candidates: selected, setCandidates } = useSelection();
  const { systemId } = useSystemRoute();
  const tabs = [
    { id: "delta" as const, label: "Semantic delta" },
    { id: "files" as const, label: "Files" },
    { id: "evals" as const, label: "Evaluations" },
    ...(realization.target === "genome" ? [{ id: "amendment" as const, label: "Amendment" }] : []),
  ];
  if (!candidate) {
    return (
      <section className={styles.panel} aria-label={`Review ${realization.id}`}>
        <h3>Review {realization.id}</h3>
        <EmptyState title="No candidate yet. The agent has not submitted, so there is nothing to review." />
        <Checkpoints realization={realization} />
      </section>
    );
  }
  const isSelected = selected.includes(candidate.id);
  const toggle = () => setCandidates(isSelected ? selected.filter((c) => c !== candidate.id) : [...selected, candidate.id]);
  return (
    <section className={styles.panel} aria-label={`Review ${realization.id}`}>
      <div className={styles.rhead}>
        <h3>Review {realization.id}</h3>
        <Button type="button" variant="secondary" aria-pressed={isSelected} onClick={toggle}>
          {isSelected ? "Selected for composition" : "Select for composition"}
        </Button>
      </div>
      <p className={styles.rmeta}>
        Candidate <code>{candidate.id}</code> · {candidate.state} · base <code>{candidate.baseRevision}</code> · <BuildChip build={candidate.build} />
      </p>
      <RerunChecks candidate={candidate} />
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
  const uid = useId();
  const m = useModel();
  const { token } = useAdminToken();
  const rerun = useEvaluateCandidate();
  const reason = m.bundle.source === "fixture"
    ? "Re-run checks needs the platform API. The UI is showing fixture data."
    : candidate.state === "promoted" || candidate.state === "rejected"
      ? `${candidate.id} is ${candidate.state}; its checks are final.`
      : null;
  const ran = rerun.isSuccess && rerun.variables?.candidateId === candidate.id ? rerun.data : null;
  return (
    <div className={styles.actions}>
      <Button
        type="button"
        variant="secondary"
        disabled={!!reason || rerun.isPending}
        aria-describedby={reason ? `${uid}-why` : undefined}
        onClick={() => rerun.mutate({ candidateId: candidate.id, ...(token && { adminToken: token }) })}
      >
        {rerun.isPending ? "Re-running checks…" : "Re-run checks"}
      </Button>
      {reason && <span id={`${uid}-why`} className={styles.muted}>{reason}</span>}
      {ran && <span role="status" className={styles.muted}>Checks re-run: {ran.evaluations.length} evaluation{ran.evaluations.length === 1 ? "" : "s"} recorded.</span>}
      {rerun.isError && <span role="alert" className={styles.error}>{rerunError(rerun.error)}</span>}
    </div>
  );
}

function Checkpoints({ realization }: { realization: Realization }) {
  if (!realization.checkpoints.length) return null;
  return (
    <ul className={styles.plain} aria-label="Checkpoints">
      {realization.checkpoints.map((c, i) => <li key={i}>{c.summary} <span className={styles.muted}>· {c.at}</span></li>)}
    </ul>
  );
}

function SubjectGroup({ title, ids }: { title: string; ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className={styles.group}>
      <h4>{title}</h4>
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
    <div className={styles.stack}>
      <SubjectGroup title="Added" ids={g.added} />
      <SubjectGroup title={g.unknownOp ? "Changed (operation unknown)" : "Changed"} ids={g.changed} />
      <SubjectGroup title="Removed" ids={g.removed} />
      {g.unmapped.length > 0 && (
        <div className={styles.group}>
          <h4>Unmapped</h4>
          <p className={styles.muted}>These changes could not be tied to a model node.</p>
          <ul className={styles.plain}>{g.unmapped.map((s) => <li key={s}><code>{s.replace(/^unmapped:/, "")}</code></li>)}</ul>
        </div>
      )}
      {candidate.genomeChanges?.length > 0 && (
        <div className={styles.group}>
          <h4>Genome changes</h4>
          <ul className={styles.plain}>{candidate.genomeChanges.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <div className={styles.group}>
        <h4>Affected criteria</h4>
        {criteria.length ? (
          <ul className={styles.plain}>
            {criteria.map((c) => {
              const v = aggregate([verdictFor(c, evals, own)]);
              return <li key={c} className={styles.inlineRow}><NodeChip id={c} size="sm" /><VerdictBadge verdict={v} /></li>;
            })}
          </ul>
        ) : <p className={styles.muted}>none</p>}
      </div>
      <div className={styles.group}>
        <h4>Affected journeys</h4>
        {journeys.length ? <ul className={styles.chips}>{journeys.map((j) => <li key={j}><NodeChip id={j} size="sm" /></li>)}</ul> : <p className={styles.muted}>none</p>}
      </div>
    </div>
  );
}

function Files({ candidate }: { candidate: Candidate }) {
  const unmapped = new Set((candidate.changedSubjects ?? []).filter((s) => s.startsWith("unmapped:")).map((s) => s.slice("unmapped:".length)));
  const paths = candidate.changedPaths ?? [];
  if (!paths.length) return <EmptyState title="No changed files recorded for this candidate." />;
  return (
    <ul className={styles.plain} aria-label="Changed files">
      {paths.map((p) => (
        <li key={p}>
          <code>{p}</code>
          {unmapped.has(p) && <span className={styles.unmapped}> unmapped</span>}
        </li>
      ))}
    </ul>
  );
}

function CandidateEvaluations({ candidate }: { candidate: Candidate }) {
  const m = useModel();
  const rows = useMemo(() => m.evaluations.filter((e) => e.candidate === candidate.id), [m.evaluations, candidate.id]);
  return <EvaluationsTable evaluations={rows} compact emptyTitle="No evaluations yet for this candidate — nothing is known" />;
}
