import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ChangelogEntry, ChangelogRow } from "../../../shared/api";
import { useChangelogEntry } from "@/api/queries";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusChip, buildTone } from "@/components/StatusChip/StatusChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useKeepParams, useSystemRoute, viewPath } from "@/model/useSelection";
import { shortSha } from "@/model/time";
import { useSemanticDelta } from "@/views/compare/genomeDelta";
import { SemanticDelta } from "@/views/work/panels/amendment/SemanticDelta";
import styles from "./changelog.module.css";

const GLYPH = { added: "+", modified: "~", removed: "−" } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.sectionHead}>{title}</h3>
      {children}
    </section>
  );
}

function Files({ entry, row }: { entry: ChangelogEntry; row: ChangelogRow }) {
  const { systemId } = useSystemRoute();
  if (!entry.codeLinks.length) return <p className={styles.muted}>No files changed.</p>;
  return (
    <ul className={styles.files}>
      {entry.codeLinks.map((f) => {
        // A removed file only exists on the parent side.
        const rev = f.status === "removed" && row.parent ? row.parent : row.id;
        const to = `${viewPath(systemId, rev, "code")}?${new URLSearchParams({ repo: f.scope, path: f.path })}`;
        return (
          <li key={`${f.scope}:${f.path}`} data-status={f.status} data-scope={f.scope}>
            <span className={styles.glyph} aria-label={f.status}>{GLYPH[f.status]}</span>
            <Link to={to} className="u-marker"><code>{f.path}</code></Link>
            {f.nodes.map((n) => <NodeChip key={n} id={n} size="sm" />)}
          </li>
        );
      })}
    </ul>
  );
}

function Detail({ entry, row }: { entry: ChangelogEntry; row: ChangelogRow }) {
  const href = useKeepParams();
  const { systemId } = useSystemRoute();
  const delta = useSemanticDelta(entry.genome.delta, row.parent, row.id);
  const evaluations = entry.criteria.flatMap((c) => (c.evaluation ? [c.evaluation] : []));
  return (
    <>
      <Section title="Genome">
        {delta ? (
          <SemanticDelta delta={delta} />
        ) : (
          <p className={styles.muted}>{entry.genome.loadError ? `Genome comparison unknown: ${entry.genome.loadError}` : "No Genome comparison."}</p>
        )}
        <p><Link to={viewPath(systemId, row.id, "map")} className="u-marker">Open this revision in the Map</Link></p>
      </Section>
      <Section title="Files">
        <Files entry={entry} row={row} />
      </Section>
      <Section title="Criteria">
        {entry.criteria.length ? (
          <ul className={styles.criteria}>
            {entry.criteria.map((c) => (
              <li key={c.id}>
                <Link to={href("evaluations", { criterion: c.id })} className="u-marker"><code>{c.id}</code></Link>
                <VerdictBadge verdict={c.before} label={`before ${c.before}`} />
                <span aria-hidden="true">→</span>
                <VerdictBadge verdict={c.after} label={`after ${c.after}`} />
              </li>
            ))}
          </ul>
        ) : <p className={styles.muted}>No criteria affected.</p>}
      </Section>
      <Section title="Evaluations">
        {evaluations.length ? (
          <ul className={styles.inlineList}>
            {evaluations.map((id) => (
              <li key={id}><Link to={href("evaluations", { evaluation: id })} className="u-marker"><code>{id}</code></Link></li>
            ))}
          </ul>
        ) : <p className={styles.muted}>No evaluations linked.</p>}
      </Section>
      <Section title="Builds and deployment">
        {row.builds.length || row.deployment ? (
          <ul className={styles.inlineList}>
            {row.builds.map((b) => (
              <li key={b.id}>
                <Link to={href("phenome", { build: b.id })} className="u-marker">{b.id}</Link>{" "}
                <StatusChip status={b.status} label={`${b.kind} ${b.status}`} tone={buildTone(b.status)} />
              </li>
            ))}
            {row.deployment && (
              <li>
                <Link to={href("phenome", { deployment: row.deployment.id })} className="u-marker">{row.deployment.id}</Link>{" "}
                <StatusChip status={row.deployment.status} label={`${row.deployment.kind} ${row.deployment.status}`} tone={row.deployment.status === "failed" ? "fail" : "neutral"} />
              </li>
            )}
          </ul>
        ) : <p className={styles.muted}>No builds or deployments recorded.</p>}
      </Section>
      <Section title="Provenance">
        <dl className={styles.facts}>
          <dt>Rationale</dt>
          <dd>{entry.decision.rationale || "No rationale recorded."}</dd>
          <dt>Platform</dt>
          <dd>{row.platform ? <code>{row.platform.repo}@{shortSha(row.platform.commit)}</code> : "unknown"}</dd>
          <dt>Manifest hash</dt>
          <dd>{row.manifestHash ? <><code>{row.manifestHash.slice(0, 16)}</code> <CopyButton value={row.manifestHash} label="Copy manifest hash" /></> : "unknown"}</dd>
          <dt>Genome commit</dt>
          <dd><code>{shortSha(row.genomeCommit)}</code></dd>
          <dt>Candidates</dt>
          <dd>{row.candidates.length ? row.candidates.map((c) => <code key={c.id} className={styles.inline}>{c.id} ({c.agent})</code>) : "none"}</dd>
        </dl>
      </Section>
      {row.parent && (
        <p>
          <Link to={href("compare", { from: row.parent, to: row.id })} className={`u-brackets ${styles.btn}`}>Compare with parent</Link>
        </p>
      )}
    </>
  );
}

/** The expanded body of a commit row, loaded per commit (entries are immutable). */
export function CommitDetail({ id, row }: { id: string; row: ChangelogRow }) {
  const q = useChangelogEntry(row.id);
  return (
    <div id={id} className={styles.detail}>
      {q.isLoading ? (
        <p role="status">Loading commit {row.id}…</p>
      ) : q.isError || !q.data ? (
        <p role="alert" className={styles.error}>
          Could not load this commit's detail. <button type="button" className={`u-brackets ${styles.btn}`} onClick={() => void q.refetch()}>Retry</button>
        </p>
      ) : (
        <Detail entry={q.data} row={row} />
      )}
    </div>
  );
}
