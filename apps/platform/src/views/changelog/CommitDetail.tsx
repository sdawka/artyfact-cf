import { Button } from "@/components/ui";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ChangelogEntry, ChangelogRow } from "../../../shared/api";
import { useChangelogEntry } from "@/api/queries";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { buildTone } from "@/components/StatusChip/StatusChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useKeepParams, useSystemRoute, viewPath } from "@/model/useSelection";
import { shortSha } from "@/model/time";
import { useSemanticDelta } from "@/views/compare/genomeDelta";
import { LEGACY_NOTICE } from "@/views/compare/legacy";
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
            <Link to={to}><code>{f.path}</code></Link>
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
  const hasBuilds = row.builds.length > 0 || !!row.deployment;
  // Sections with nothing in them fold into one line instead of three "No X recorded." paragraphs.
  const empty = [
    ...(entry.criteria.length ? [] : ["criteria"]),
    ...(evaluations.length ? [] : ["evaluations"]),
    ...(hasBuilds ? [] : ["builds", "deployments"]),
  ];
  return (
    <>
      <div className={styles.detailHead}>
        {row.parent && <Button asChild variant="secondary"><Link to={href("compare", { from: row.parent, to: row.id })}>Compare with parent</Link></Button>}
        {!row.legacyFormat && <Link to={viewPath(systemId, row.id, "map")} className="u-marker">Open in Map</Link>}
      </div>
      <Section title="Genome">
        {row.legacyFormat ? (
          // A v1 Genome has no node delta and no model to open; its files below still diff.
          <p role="note" className={styles.muted}>{LEGACY_NOTICE}</p>
        ) : delta ? (
          <SemanticDelta delta={delta} summary />
        ) : (
          <p className={styles.muted}>{entry.genome.loadError ? `Genome comparison unknown: ${entry.genome.loadError}` : "No Genome comparison."}</p>
        )}
      </Section>
      <Section title="Files">
        <Files entry={entry} row={row} />
      </Section>
      {entry.criteria.length > 0 && (
        <Section title="Criteria">
          <ul className={styles.criteria}>
            {entry.criteria.map((c) => (
              <li key={c.id}>
                <Link to={href("evaluations", { criterion: c.id })}><code>{c.id}</code></Link>
                <VerdictBadge verdict={c.before} label={`before ${c.before}`} />
                <ArrowRightIcon aria-hidden="true" />
                <VerdictBadge verdict={c.after} label={`after ${c.after}`} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {evaluations.length > 0 && (
        <Section title="Evaluations">
          <ul className={styles.inlineList}>
            {evaluations.map((id) => (
              <li key={id}><Link to={href("evaluations", { evaluation: id })}><code>{id}</code></Link></li>
            ))}
          </ul>
        </Section>
      )}
      {hasBuilds && (
        <Section title="Builds and deployment">
          <ul className={styles.inlineList}>
            {row.builds.map((b) => (
              <li key={b.id}>
                <Link to={href("phenome", { build: b.id })}><code>{b.id}</code></Link>
                <StatusText status={b.status} label={`${b.kind} ${b.status}`} tone={buildTone(b.status)} />
              </li>
            ))}
            {row.deployment && (
              <li>
                <Link to={href("phenome", { deployment: row.deployment.id })}><code>{row.deployment.id}</code></Link>
                <StatusText status={row.deployment.status} label={`${row.deployment.kind} ${row.deployment.status}`} tone={row.deployment.status === "failed" ? "fail" : "neutral"} />
              </li>
            )}
          </ul>
        </Section>
      )}
      {empty.length > 0 && <p className={styles.muted}>No {empty.length > 1 ? `${empty.slice(0, -1).join(", ")} or ${empty.at(-1)}` : empty[0]} yet.</p>}
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
          Could not load this commit's detail. <Button type="button" variant="secondary" onClick={() => void q.refetch()}>Retry</Button>
        </p>
      ) : (
        <Detail entry={q.data} row={row} />
      )}
    </div>
  );
}
