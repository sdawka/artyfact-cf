import { Link } from "react-router";
import type { Build, Deployment } from "../../../shared/api";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { buildTone } from "@/components/StatusChip/StatusChip";
import { Button } from "@/components/ui";
import { Unknown } from "@/components/Unknown/Unknown";
import { useKeepParams } from "@/model/useSelection";
import { BUILD_GLYPH, duration, short } from "./lib";
import { ExpandRow, When } from "./tables";
import styles from "./phenome.module.css";

export function BuildsSection({ builds, production, loading, error, onRetry }: {
  builds: Build[];
  production: Deployment | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const href = useKeepParams();
  return (
    <Section title="Builds" count={error || loading ? undefined : builds.length}>
      {error ? (
        <EmptyState kind="error" title="Could not load builds." onRetry={onRetry}>{error.message}</EmptyState>
      ) : loading ? (
        <p role="status" className={styles.quiet}>Loading builds…</p>
      ) : builds.length === 0 ? (
        <p className={styles.quiet}>No builds yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.stack}`}>
            <thead>
              <tr>
                <th className={styles.toggleCell}><span className="sr-only">Details</span></th>
                <th>Status</th><th>Kind</th><th>Commit</th><th>Output</th><th>Started</th><th>Duration</th>
                <th><span className="sr-only">Links</span></th>
              </tr>
            </thead>
            <tbody>
              {builds.map((b) => (
                <ExpandRow
                  key={b.id}
                  id={`build-${b.id}`}
                  label={b.id}
                  columns={7}
                  cells={<>
                    <td><StatusText status={b.status} tone={buildTone(b.status)} glyph={BUILD_GLYPH[b.status]} /></td>
                    <td className={styles.nowrap}>{b.kind}</td>
                    <td className={styles.line2} data-label="Commit"><code>{short(b.commit)}</code></td>
                    <td className={styles.line2} data-label="Output">{b.output ? <code className={styles.truncate} title={b.output.id}>{b.output.id}</code> : <Unknown />}</td>
                    <td className={styles.line2} data-label="Started"><When iso={b.startedAt} /></td>
                    <td className={styles.line2} data-label="Duration">{duration(b.startedAt, b.finishedAt) ?? <Unknown />}</td>
                    <td className={styles.links}>
                      {b.url && <Button asChild variant="ghost" size="compact"><a href={b.url} target="_blank" rel="noopener noreferrer">Preview<span className="sr-only"> of {b.id}</span></a></Button>}
                      {b.logsUrl && <Button asChild variant="ghost" size="compact"><a href={b.logsUrl} target="_blank" rel="noopener noreferrer">Logs<span className="sr-only"> of {b.id}</span></a></Button>}
                    </td>
                  </>}
                >
                  <div className={styles.detail}>
                    {b.steps && b.steps.length > 0 && (
                      <ul className={styles.steps} aria-label={`Steps of ${b.id}`}>
                        {b.steps.map((s) => (
                          <li key={s.name}><StatusText status={s.status} tone={buildTone(s.status)} glyph={BUILD_GLYPH[s.status]} label={`${s.name}: ${s.status}`} /></li>
                        ))}
                      </ul>
                    )}
                    {b.error && <p className={styles.errorText}>{b.error}</p>}
                    <dl className={styles.inlineFacts}>
                      {b.output && <div><dt>Source</dt><dd>{b.output.source.repo}@{short(b.output.source.commit)}</dd></div>}
                      {b.output && <div><dt>Genome</dt><dd>{short(b.output.genomeCommit)}</dd></div>}
                      {b.candidate && <div><dt>Candidate</dt><dd><code>{b.candidate}</code></dd></div>}
                      {b.realization && <div><dt>Realization</dt><dd><Link to={href("work", { realization: b.realization })}>{b.realization}</Link></dd></div>}
                      <div><dt>Finished</dt><dd><When iso={b.finishedAt} /></dd></div>
                      {production && b.kind === "production" && production.build === b.id && production.systemCommit && <div><dt>Represents</dt><dd>{production.systemCommit}</dd></div>}
                    </dl>
                  </div>
                </ExpandRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
