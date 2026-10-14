import { Button, Checkbox, Input, Textarea } from "@/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { Candidate, ConflictReport, Evolution } from "../../../../shared/api";
import { useAdminTokenField } from "@/api/adminToken";
import { ApiRequestError, StaleBaseError } from "@/api/client";
import { useCandidates, useConflicts, useEvolutions, useHistory, usePromote } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection, useSystemRoute } from "@/model/useSelection";
import { describeConflict, gateCoverage, gatesSummary, headOf, splitConflicts, type GateRow } from "../gates";
import type { UiVerdict } from "@/model/status";
import { mergeConflicts, shortSha } from "../lib";
import { describeIssue } from "../gates";
import { emitFx } from "@/effects/fx";
import { whyFor } from "../../code/why";
import styles from "../work.module.css";

/** `details` of a refused promotion: `{ criteria, advisories }` (the blocking items are `criteria`). */
function serverIssues(err: unknown): { blocking: unknown[]; advisories: unknown[] } | null {
  if (!(err instanceof ApiRequestError) || err instanceof StaleBaseError) return null;
  const d = err.body?.error?.details as { criteria?: unknown[]; advisories?: unknown[] } | undefined;
  if (!d || (!Array.isArray(d.criteria) && !Array.isArray(d.advisories))) return null;
  return { blocking: d.criteria ?? [], advisories: d.advisories ?? [] };
}

interface GateItemLike { candidate?: string; criterion: string; severity?: string; verdict?: string; execution?: string }
const isGateItem = (x: unknown): x is GateItemLike => !!x && typeof x === "object" && typeof (x as GateItemLike).criterion === "string";

/** What the badge should say for a server gate item. */
export function itemVerdict(i: GateItemLike): UiVerdict {
  const known = i.verdict === "pass" || i.verdict === "fail" || i.verdict === "stale" || i.verdict === "waived" || i.verdict === "unknown";
  if (i.execution === "error") return "unknown";
  if (i.execution !== undefined && i.execution !== "completed") return "not-run";
  if (!known) return "not-run";
  // An absent execution falls back to the verdict; only `pass` needs a completed run to count.
  return i.verdict === "pass" && i.execution !== "completed" ? "unknown" : (i.verdict as UiVerdict);
}

/** A server-reported blocking or advisory item: criterion chip with its title, candidate, verdict and execution. */
function IssueList({ items }: { items: readonly unknown[] }) {
  return (
    <ul className={styles.plain}>
      {items.map((x, i) =>
        isGateItem(x) ? (
          <li key={`${x.candidate ?? ""}-${x.criterion}-${i}`} className={styles.inlineRow}>
            <NodeChip id={x.criterion} size="sm" showId glyph={false} />
            <VerdictBadge verdict={itemVerdict(x)} />
            <span className={styles.muted}>{[x.candidate, x.execution && x.execution !== "completed" ? x.execution : undefined, x.severity].filter(Boolean).join(" · ")}</span>
          </li>
        ) : (
          <li key={i}>{typeof x === "string" ? x : describeIssue(x)}</li>
        ),
      )}
    </ul>
  );
}

/** Promote selected candidates: manifest, base vs head, gate coverage, advisories, rationale, compare-and-swap. */
export function PromotionPanel({ evolution }: { evolution: Evolution }) {
  const uid = useId();
  const m = useModel();
  const qc = useQueryClient();
  const { systemId } = useSystemRoute();
  const href = useKeepParams();
  const { candidates: selected, setCandidates } = useSelection();
  const { data: cand } = useCandidates(evolution.id);
  const { data: allConflicts } = useConflicts();
  const { data: commits } = useHistory();
  const { isPending: boardLoading } = useEvolutions();
  const promote = usePromote();
  const [rationale, setRationale] = useState("");
  const [rationaleEdited, setRationaleEdited] = useState(false);
  const [ack, setAck] = useState(false);
  const [adminToken, setAdminToken, resetAdminToken] = useAdminTokenField();
  const panelRef = useRef<HTMLElement>(null);

  const candidates: Candidate[] = cand?.candidates ?? [];
  const chosen = candidates.filter((c) => selected.includes(c.id));
  const ids = chosen.map((c) => c.id);
  // Realize an editor commit: start from the commit's "why" until the admin edits it.
  const editorWhy = whyFor(systemId, chosen.map((c) => c.realization));
  useEffect(() => {
    if (!rationaleEdited) setRationale(editorWhy ?? "");
  }, [editorWhy, rationaleEdited]);
  const head = headOf(commits);
  // The gate set comes from the server (the set it enforces); verdicts fold every hook's row like the server does.
  const coverage = useMemo(
    () => gateCoverage(m.index.model.criteria ?? [], cand?.gates, m.evaluations, ids),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m.index.model.criteria, cand?.gates, m.evaluations, ids.join(",")],
  );
  const rows = coverage.rows;
  const required = rows.filter((r) => r.required);
  const softRows = rows.filter((r) => !r.required);
  const conflicts: ConflictReport[] = mergeConflicts(cand?.conflicts, allConflicts);
  const split = splitConflicts(conflicts, ids);
  const refusedAdvisories = serverIssues(promote.error)?.advisories.length ?? 0;
  const advisoryCount = softRows.filter((r) => r.verdict !== "pass").length + split.advisories.length + refusedAdvisories;

  const fixture = m.bundle.source === "fixture";
  const stale = promote.error instanceof StaleBaseError ? promote.error : null;
  const refused = serverIssues(promote.error);
  const failing = required.filter((r) => r.blocking);
  const reasons: string[] = [];
  if (boardLoading) reasons.push("Loading board data…");
  if (fixture) reasons.push("Promotion needs the platform API. The UI is showing fixture data.");
  if (!ids.length) reasons.push("Select at least one candidate.");
  if (!fixture && coverage.missing.length) {
    reasons.push(`The server reported no promotion gate for ${coverage.missing.join(", ")}${cand?.gatesError ? ` (${cand.gatesError})` : ""}; refresh before promoting.`);
  }
  if (ids.length && failing.length) reasons.push(`${failing.length} required gate${failing.length === 1 ? " is" : "s are"} not pass/completed: ${failing.map((r) => r.criterion.id).join(", ")}.`);
  if (split.blocking.length) reasons.push(`${split.blocking.length} blocking conflict${split.blocking.length === 1 ? "" : "s"} between the selected candidates.`);
  if (!rationale.trim()) reasons.push("Write a rationale.");
  if (advisoryCount > 0 && !ack) reasons.push("Acknowledge the advisories in the rationale.");
  if (refused?.blocking.length) reasons.push(`The server refused: ${refused.blocking.length} blocking item${refused.blocking.length === 1 ? "" : "s"} (listed above). Fix them, then refresh.`);
  if (stale) reasons.push(`The head moved to ${shortSha(stale.currentHead)}; refresh and re-evaluate.`);

  const setSelection = (next: string[]) => {
    if (promote.isError) promote.reset();
    setCandidates(next);
  };
  const refresh = () => {
    promote.reset();
    for (const k of ["evolutions", "candidates", "evaluations", "history", "conflicts"]) void qc.invalidateQueries({ queryKey: [k, systemId] });
  };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (reasons.length) return;
    promote.mutate(
      { body: { candidates: ids, expectedHead: head, rationale: rationale.trim() }, ...(adminToken && { adminToken }) },
      { onSuccess: () => emitFx({ kind: "promoted", strength: 1.6 }, panelRef.current) },
    );
  };

  if (promote.isSuccess) {
    const c = promote.data.commit;
    return (
      <section ref={panelRef} className={styles.panel} aria-labelledby={`${uid}-h`}>
        <h3 id={`${uid}-h`}>Promoted</h3>
        <p role="status">
          System commit <code>{shortSha(c.id)}</code> recorded. {promote.data.rejected.length > 0 && <>Rejected siblings: {promote.data.rejected.join(", ")}. </>}
          <Link to={href("changelog", { commit: c.id, evolution: null, panel: null })} className="u-marker">Open in Changelog</Link>
        </p>
      </section>
    );
  }

  return (
    <section ref={panelRef} className={styles.panel} aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>Promote {evolution.title}</h3>

      <fieldset className={styles.fieldset}>
        <legend>Candidates to promote</legend>
        {candidates.length ? (
          <ul className={styles.plain}>
            {candidates.map((c) => (
              <li key={c.id}>
                <label>
                  <Checkbox
                    checked={selected.includes(c.id)}
                    onChange={(e) => setSelection(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
                  />{" "}
                  <code>{c.id}</code> <span className={styles.muted}>{c.state} · manifest {c.hash ? shortSha(c.hash) : "unknown"}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No submitted candidates for this Evolution.</p>
        )}
      </fieldset>

      <dl className={styles.facts}>
        <dt>Manifest hash</dt>
        <dd>{chosen.length ? chosen.map((c) => <code key={c.id} className={styles.inlineCode}>{c.hash ?? "unknown"}</code>) : "none selected"}</dd>
        <dt>Base</dt>
        <dd>{chosen.length ? chosen.map((c) => <code key={c.id} className={styles.inlineCode}>{c.baseRevision}</code>) : "none selected"}</dd>
        <dt>Current head</dt>
        <dd><code>{head ?? "none (first promotion)"}</code></dd>
      </dl>

      <h4>Required gates</h4>
      {ids.length ? (
        <>
          <GatesSummaryLine rows={required} />
          <GateTable rows={required} label="Required gate coverage" />
        </>
      ) : (
        <p className={styles.muted}>Select a candidate to see gate coverage. Without one every gate is not-run.</p>
      )}

      <div className={styles.advisories} role="group" aria-label="Advisories">
        <h4>Advisories</h4>
        <p className={styles.muted}>Advisories never block promotion, but the rationale must say how each was weighed.</p>
        {softRows.length === 0 && split.advisories.length === 0 && !refused?.advisories.length ? (
          <p className={styles.muted}>none</p>
        ) : (
          <>
            {softRows.length > 0 && <GateTable rows={softRows} label="Advisory criteria" />}
            {(split.advisories.length > 0 || !!refused?.advisories.length) && (
              <ul className={styles.plain}>
                {split.advisories.map((c, i) => <li key={`c${i}`}>{describeConflict(c)}</li>)}
              </ul>
            )}
            {!!refused?.advisories.length && <IssueList items={refused.advisories} />}
          </>
        )}
      </div>

      {(split.blocking.length > 0 || !!refused?.blocking.length) && (
        <div className={styles.blocking} role="group" aria-label="Blocking">
          <h4>Blocking</h4>
          {split.blocking.length > 0 && <ul className={styles.plain}>{split.blocking.map((c, i) => <li key={`c${i}`}>{describeConflict(c)}</li>)}</ul>}
          {!!refused?.blocking.length && (
            <>
              <IssueList items={refused.blocking} />
              <Button type="button" variant="secondary" onClick={refresh}>Refresh</Button>
            </>
          )}
        </div>
      )}

      {stale && (
        <div role="alert" className={styles.error}>
          <p>The head moved to <code>{shortSha(stale.currentHead)}</code>; re-evaluate before promoting.</p>
          <p>
            A candidate built on an earlier head is refused until its agent rebases the fork on{" "}
            <code>{shortSha(stale.currentHead)}</code> and submits again: <code>artyfact submit</code>.
          </p>
          <Button type="button" variant="secondary" onClick={refresh}>Refresh</Button>
        </div>
      )}
      {promote.isError && !stale && !refused && <p role="alert" className={styles.error}>{promote.error.message}</p>}

      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-r`}>Rationale</label>
          <Textarea id={`${uid}-r`} value={rationale} onChange={(e) => { setRationaleEdited(true); setRationale(e.target.value); }} rows={4} required />
          {editorWhy && !rationaleEdited && <p className={styles.muted}>Rationale pending: pre-filled from the editor commit's why. Edit it to confirm.</p>}
        </div>
        {advisoryCount > 0 && (
          <label className={styles.check}>
            <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} /> My rationale addresses the {advisoryCount} advisor{advisoryCount === 1 ? "y" : "ies"}
          </label>
        )}
        <div className={styles.field}>
          <label htmlFor={`${uid}-t`}>Admin token</label>
          <Input id={`${uid}-t`} type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} autoComplete="off" />
        </div>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={reasons.length > 0 || promote.isPending} aria-describedby={reasons.length ? `${uid}-why` : undefined}>
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        </div>
        {reasons.length > 0 && (
          <ul id={`${uid}-why`} className={styles.reasons} aria-label="Why promotion is disabled">
            {reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
      </form>
      <p className={styles.muted}>Compare-and-swap on head <code>{head ?? "none"}</code>: the server refuses if it has moved.</p>
    </section>
  );
}

/** "4 pass · 1 unknown": the success tone only when every required gate passes. */
function GatesSummaryLine({ rows }: { rows: GateRow[] }) {
  const { text, allPass } = gatesSummary(rows);
  return <p className={styles.rmeta} data-tone={allPass ? "pass" : undefined} data-testid="gates-summary">{allPass ? "✓ " : ""}{text}</p>;
}

function GateTable({ rows, label }: { rows: GateRow[]; label: string }) {
  if (!rows.length) return <p className={styles.muted}>none</p>;
  return (
    <table className={styles.gates} aria-label={label}>
      <thead>
        <tr><th scope="col">Criterion</th><th scope="col">Hook</th><th scope="col">Verdict</th><th scope="col">Execution</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.criterion.id}>
            <td><NodeChip id={r.criterion.id} size="sm" glyph={false} /></td>
            <td><code>{r.hook}</code></td>
            <td><VerdictBadge verdict={r.verdict} /></td>
            <td>{r.execution}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
