import { Button, Checkbox, Input, Textarea } from "@/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { Candidate, ConflictReport, Evolution } from "../../../../shared/api";
import { useAdminToken, useAdminTokenField } from "@/api/adminToken";
import { ApiRequestError, StaleBaseError } from "@/api/client";
import { useCandidates, useConflicts, useEvolutions, useHistory, usePromote } from "@/api/queries";
import { MetaLine, type MetaItem } from "@/components/MetaLine/MetaLine";
import { KindGlyphs, NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection, useSystemRoute } from "@/model/useSelection";
import { describeConflict, gateCoverage, headOf, splitConflicts, type GateRow } from "../gates";
import type { UiVerdict } from "@/model/status";
import { mergeConflicts, shortSha } from "../lib";
import { describeIssue } from "../gates";
import { emitFx } from "@/effects/fx";
import { whyFor } from "../../code/why";
import { DecisionHead } from "./DecisionHead";
import { VerdictSummary } from "./VerdictSummary";
import styles from "./decision.module.css";

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

function issueMeta(x: GateItemLike): MetaItem[] {
  const out: MetaItem[] = [];
  if (x.candidate) out.push({ value: x.candidate, code: true });
  if (x.execution && x.execution !== "completed") out.push({ label: "execution", value: x.execution });
  if (x.severity) out.push({ label: "severity", value: x.severity });
  return out;
}

/** A server-reported blocking or advisory item: criterion chip with its title, candidate, verdict and execution. */
function IssueList({ items }: { items: readonly unknown[] }) {
  return (
    <KindGlyphs hidden><ul className={styles.plain}>
      {items.map((x, i) =>
        isGateItem(x) ? (
          <li key={`${x.candidate ?? ""}-${x.criterion}-${i}`} className={styles.inlineRow}>
            <NodeChip id={x.criterion} size="sm" showId glyph={false} />
            <VerdictBadge verdict={itemVerdict(x)} />
            <MetaLine items={issueMeta(x)} />
          </li>
        ) : (
          <li key={i}>{typeof x === "string" ? x : describeIssue(x)}</li>
        ),
      )}
    </ul></KindGlyphs>
  );
}

/**
 * The promotion desk: Promote in the header with its first blocking reason; a 409 at the top; then the candidates, base
 * vs head, the required gates (advisories only when there are any) and the rationale. The server compares the head.
 */
export function PromotionPanel({ evolution, autoFocus = false }: { evolution: Evolution; autoFocus?: boolean }) {
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
  const { token: headerToken } = useAdminToken();
  const [adminToken, setAdminToken] = useAdminTokenField();
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
  if (stale) reasons.push(`The head moved to ${shortSha(stale.currentHead)}; refresh and re-evaluate.`);
  if (refused?.blocking.length) reasons.push(`The server refused: ${refused.blocking.length} blocking item${refused.blocking.length === 1 ? "" : "s"} (listed below). Fix them, then refresh.`);
  if (boardLoading) reasons.push("Loading board data…");
  if (fixture) reasons.push("Promotion needs the platform API. The UI is showing fixture data.");
  if (!ids.length) reasons.push("Add at least one candidate.");
  if (!fixture && coverage.missing.length) {
    reasons.push(`The server reported no promotion gate for ${coverage.missing.join(", ")}${cand?.gatesError ? ` (${cand.gatesError})` : ""}; refresh before promoting.`);
  }
  if (ids.length && failing.length) reasons.push(`${failing.length} required gate${failing.length === 1 ? " is" : "s are"} not pass/completed: ${failing.map((r) => r.criterion.id).join(", ")}.`);
  if (split.blocking.length) reasons.push(`${split.blocking.length} blocking conflict${split.blocking.length === 1 ? "" : "s"} between the selected candidates.`);
  if (!rationale.trim()) reasons.push("Write a rationale.");
  if (advisoryCount > 0 && !ack) reasons.push("Acknowledge the advisories in the rationale.");
  const [firstReason, ...moreReasons] = reasons;

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
      <section ref={panelRef} className={styles.pane} aria-labelledby={`${uid}-h`}>
        <DecisionHead title={<span id={`${uid}-h`}>Promoted {evolution.title}</span>} autoFocus status={<StatusText status="promoted" glyph="↑" label="promoted" />} />
        <div className={styles.result} role="status">
          <p>
            System commit <code title={c.id}>{shortSha(c.id)}</code> recorded.{promote.data.rejected.length > 0 && <> Rejected siblings: {promote.data.rejected.join(", ")}.</>}
          </p>
          <MetaLine items={[{ label: "commit", value: c.id, code: true }, { label: "deployment", value: "requested, state unknown" }]} />
          <p className={styles.links}>
            <Link to={href("changelog", { commit: c.id, evolution: null, panel: null, candidates: null })} className="u-marker">Open in Changelog</Link>
            <Link to={href("phenome", { evolution: null, panel: null, candidates: null })}>Open Deployments</Link>
          </p>
        </div>
      </section>
    );
  }

  const formId = `${uid}-form`;
  return (
    <section ref={panelRef} className={styles.pane} aria-labelledby={`${uid}-h`}>
      <DecisionHead
        title={<span id={`${uid}-h`}>Promote {evolution.title}</span>}
        autoFocus={autoFocus}
        status={ids.length && required.length ? <VerdictSummary verdicts={required.map((r) => r.verdict)} testId="gates-summary" /> : undefined}
        primary={
          <Button type="submit" form={formId} variant="primary" reason={firstReason} disabled={promote.isPending}>
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        }
      >
        {moreReasons.length > 0 && (
          <details className={styles.more}>
            <summary>{moreReasons.length} more reason{moreReasons.length === 1 ? "" : "s"}</summary>
            <ul aria-label="Why promotion is disabled">{moreReasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        )}
      </DecisionHead>

      {stale && (
        <div role="alert" className={styles.alert}>
          <p><span className={styles.alertLead}>The head moved to <code>{shortSha(stale.currentHead)}</code>.</span> Re-evaluate before promoting.</p>
          <p>
            A candidate built on an earlier head is refused until its agent rebases the fork on{" "}
            <code>{shortSha(stale.currentHead)}</code> and submits again: <code>artyfact submit</code>.
          </p>
          <Button type="button" variant="secondary" className={styles.action} onClick={refresh}>Refresh</Button>
        </div>
      )}
      {promote.isError && !stale && !refused && <p role="alert" className={styles.error}>{promote.error.message}</p>}
      {(split.blocking.length > 0 || !!refused?.blocking.length) && (
        <div className={styles.blocking} role="group" aria-label="Blocking">
          <h3 className={styles.sectionTitle}>Blocking</h3>
          {split.blocking.length > 0 && <ul className={styles.plain}>{split.blocking.map((c, i) => <li key={`c${i}`}>{describeConflict(c)}</li>)}</ul>}
          {!!refused?.blocking.length && (
            <>
              <IssueList items={refused.blocking} />
              <Button type="button" variant="secondary" onClick={refresh}>Refresh</Button>
            </>
          )}
        </div>
      )}

      <section className={styles.section} aria-labelledby={`${uid}-c`}>
        <h3 id={`${uid}-c`} className={styles.sectionTitle}>Candidates</h3>
        {candidates.length ? (
          <ul className={styles.candidates}>
            {candidates.map((c) => (
              <li key={c.id}>
                <label className={styles.candidate}>
                  <Checkbox
                    checked={selected.includes(c.id)}
                    onChange={(e) => setSelection(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
                  />
                  <code>{c.id}</code>
                  <MetaLine items={[{ value: c.state }, { label: "manifest", value: c.hash ? shortSha(c.hash) : "unknown", code: !!c.hash, ...(c.hash && { title: c.hash }) }]} />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No submitted candidates for this Evolution.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby={`${uid}-b`}>
        <h3 id={`${uid}-b`} className={styles.sectionTitle}>Base and head</h3>
        <dl className={styles.compare}>
          {chosen.map((c) => (
            <div key={c.id}>
              <dt>base</dt>
              <dd><code title={c.id}>{c.baseRevision ?? "none"}</code></dd>
              <dd>{(c.baseRevision ?? null) === head ? "= head" : <StatusText status="behind" tone="attention" glyph="↻" label="behind head" />}</dd>
            </div>
          ))}
          <div>
            <dt>head</dt>
            <dd><code>{head ?? "none (first promotion)"}</code></dd>
          </div>
        </dl>
        <p className={styles.hint}>The server refuses if the head moves before you promote.</p>
      </section>

      <section className={styles.section} aria-labelledby={`${uid}-g`}>
        <h3 id={`${uid}-g`} className={styles.sectionTitle}>Required gates</h3>
        {ids.length ? (
          <GateTable rows={required} label="Required gate coverage" />
        ) : (
          <p className={styles.muted}>Add a candidate to see its gates. Without one every gate is not-run.</p>
        )}
        {(softRows.length > 0 || split.advisories.length > 0 || !!refused?.advisories.length) && (
          <div className={styles.section} role="group" aria-label="Advisories">
            <h3 className={styles.sectionTitle}>Advisories</h3>
            <p className={styles.hint}>Advisories never block promotion, but the rationale must say how each was weighed.</p>
            {softRows.length > 0 && <GateTable rows={softRows} label="Advisory criteria" />}
            {split.advisories.length > 0 && <ul className={styles.plain}>{split.advisories.map((c, i) => <li key={`c${i}`}>{describeConflict(c)}</li>)}</ul>}
            {!!refused?.advisories.length && <IssueList items={refused.advisories} />}
          </div>
        )}
      </section>

      <form id={formId} onSubmit={submit} className={styles.form} aria-label="Promotion">
        <div className={styles.field}>
          <label htmlFor={`${uid}-r`}>Rationale</label>
          <Textarea id={`${uid}-r`} value={rationale} onChange={(e) => { setRationaleEdited(true); setRationale(e.target.value); }} rows={4} required />
          {editorWhy && !rationaleEdited && <p className={styles.hint}>Rationale pending: pre-filled from the editor commit's why. Edit it to confirm.</p>}
        </div>
        {advisoryCount > 0 && (
          <label className={styles.check}>
            <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} /> My rationale addresses the {advisoryCount} advisor{advisoryCount === 1 ? "y" : "ies"}
          </label>
        )}
        {/* The header token is the one source; this field only appears while it is unset. */}
        {!headerToken && (
          <div className={styles.field}>
            <label htmlFor={`${uid}-t`}>Admin token</label>
            <Input id={`${uid}-t`} type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} autoComplete="off" />
          </div>
        )}
      </form>
    </section>
  );
}

function GateTable({ rows, label }: { rows: GateRow[]; label: string }) {
  if (!rows.length) return <p className={styles.muted}>No gates.</p>;
  return (
    <div className={styles.tableWrap}>
      <KindGlyphs hidden>
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
      </KindGlyphs>
    </div>
  );
}
