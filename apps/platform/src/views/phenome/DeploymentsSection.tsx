import { Link } from "react-router";
import type { Deployment } from "../../../shared/api";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { Button } from "@/components/ui";
import { Unknown } from "@/components/Unknown/Unknown";
import { useKeepParams } from "@/model/useSelection";
import { short } from "./lib";
import { ExpandRow, When } from "./tables";
import styles from "./phenome.module.css";

/** Only a failed deployment reads as a failure; live is plain, never green. */
export const deploymentTone = (status: string) => (status === "failed" ? "fail" : "neutral");

export function DeploymentsSection({ production, history, loading, error, onRetry }: {
  production: Deployment | null;
  history: Deployment[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const href = useKeepParams();
  const rows = production && !history.some((d) => d.id === production.id) ? [production, ...history] : history;
  return (
    <Section title="Deployments" count={error || loading ? undefined : rows.length}>
      {error ? (
        <EmptyState kind="error" title="Could not load deployments." onRetry={onRetry}>{error.message}</EmptyState>
      ) : loading ? (
        <p role="status" className={styles.quiet}>Loading deployments…</p>
      ) : rows.length === 0 ? (
        <p className={styles.quiet}>No deployments yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.stack}`}>
            <thead>
              <tr>
                <th className={styles.toggleCell}><span className="sr-only">Details</span></th>
                <th>Status</th><th>Kind</th><th>URL</th><th>Commit</th><th>System commit</th><th><span className="sr-only">Links</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <ExpandRow
                  key={d.id}
                  id={`deployment-${d.id}`}
                  label={d.id}
                  columns={6}
                  cells={<>
                    <td><StatusText status={d.status} tone={deploymentTone(d.status)} /></td>
                    <td className={styles.nowrap}>{d.kind}</td>
                    <td className={`${styles.line2} ${styles.url}`} data-label="URL">{d.url ? <a href={d.url} title={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a> : <Unknown />}</td>
                    <td className={styles.line2} data-label="Commit"><code>{short(d.commit)}</code></td>
                    <td className={styles.line2} data-label="System commit">{d.systemCommit ? <Link to={href("changelog", { commit: d.systemCommit })}><code>{d.systemCommit}</code></Link> : <Unknown />}</td>
                    <td className={styles.links}>
                      <Button asChild variant="ghost" size="compact"><Link to={href("phenome", { deployment: d.id })}>Events<span className="sr-only"> of {d.id}</span></Link></Button>
                    </td>
                  </>}
                >
                  <dl className={styles.inlineFacts}>
                    <div><dt>Output</dt><dd>{d.output ? <code>{d.output}</code> : <Unknown />}</dd></div>
                    <div><dt>Build</dt><dd><code>{d.build ?? "unknown"}</code></dd></div>
                    <div><dt>Runtime build</dt><dd><code>{d.buildId ? short(d.buildId) : "unknown"}</code></dd></div>
                    <div><dt>By</dt><dd>{d.by}</dd></div>
                    <div><dt>Created</dt><dd><When iso={d.createdAt} /></dd></div>
                  </dl>
                </ExpandRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
