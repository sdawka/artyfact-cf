import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminToken } from "@/api/adminToken";
import { scopedRequest } from "@/api/lifecycle";
import { formStyles } from "@/components/Form/Form";
import { Button, Select } from "@/components/ui";
import { Unknown } from "@/components/Unknown/Unknown";
import { useSystemRoute } from "@/model/useSelection";
import {
  operationsPaths,
  type FlagsResponse, type MeasurementsResponse, type OperationalFlag, type OperationsAuditResponse, type RuntimeMetricsResponse,
} from "../../../shared/operations";
import { FlagForm } from "./FlagForm";
import styles from "./phenome.module.css";

const WINDOWS = [{ value: "1", label: "Last hour" }, { value: "24", label: "Last 24 hours" }, { value: "168", label: "Last 7 days" }];
const num = (n: number | null | undefined) => (n === null || n === undefined ? <Unknown>unavailable</Unknown> : n);

/** Metrics, custom measurements, flags (list, or the editor in its place) and change history for one artifact binding. */
export function BindingOperations({ binding, enabled }: { binding: string; enabled: boolean }) {
  const { systemId } = useSystemRoute();
  const { token } = useAdminToken();
  const qc = useQueryClient();
  const [hours, setHours] = useState("24");
  const [editing, setEditing] = useState<OperationalFlag | null | undefined>(undefined);
  const window = () => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(hours) * 3600000);
    return `?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`;
  };
  const metrics = useQuery({
    queryKey: ["operations", "metrics", systemId, binding, hours, token],
    queryFn: () => scopedRequest<RuntimeMetricsResponse>(operationsPaths.metrics(systemId, binding) + window(), token),
    enabled: enabled && !!binding,
  });
  const measurements = useInfiniteQuery({
    queryKey: ["operations", "measurements", systemId, binding, hours, token],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => scopedRequest<MeasurementsResponse>(operationsPaths.measurements(systemId, binding) + window() + (pageParam === undefined ? "" : `&before=${pageParam}`), token),
    getNextPageParam: (page) => page.nextBefore,
    enabled: enabled && !!binding,
  });
  const flags = useInfiniteQuery({
    queryKey: ["operations", "flags", systemId, binding, token],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => scopedRequest<FlagsResponse>(operationsPaths.flags(systemId, binding) + (pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""), token),
    getNextPageParam: (page) => page.nextCursor,
    enabled: enabled && !!binding,
  });
  const audit = useQuery({
    queryKey: ["operations", "audit", systemId, binding, token],
    queryFn: () => scopedRequest<OperationsAuditResponse>(operationsPaths.audit(systemId, binding), token),
    enabled: enabled && !!binding,
  });
  const measurementPage = measurements.data?.pages.at(-1);
  const measurementRows = measurements.data?.pages.flatMap((p) => p.measurements) ?? [];
  const flagPage = flags.data?.pages.at(-1);
  const flagRows = flags.data?.pages.flatMap((p) => p.flags) ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ["operations"] });

  return (
    <div className={styles.ops}>
      <div className={styles.opsBar}>
        <div className={formStyles.field}>
          <label htmlFor="operation-window">Observation window</label>
          <Select id="operation-window" value={hours} onChange={setHours} options={WINDOWS} />
        </div>
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
      </div>

      <section aria-labelledby="ops-metrics" className={styles.opsSection}>
        <h3 id="ops-metrics" className={styles.subhead}>Runtime metrics</h3>
        {metrics.isLoading && <p role="status" className={styles.quiet}>Loading metrics…</p>}
        {metrics.error && <p role="alert" className={styles.errorText}>{(metrics.error as Error).message}</p>}
        {metrics.data && (
          <>
            <p className={styles.quiet}>{metrics.data.state}</p>
            {metrics.data.reason && <p className={styles.quiet}>{metrics.data.reason}</p>}
            <dl className={styles.stats}>
              <div><dt>Requests</dt><dd className="u-numeric">{num(metrics.data.requests)}</dd></div>
              <div><dt>Invocation errors</dt><dd className="u-numeric">{num(metrics.data.invocationErrors)}</dd></div>
              <div><dt>CPU p50 (µs)</dt><dd className="u-numeric">{num(metrics.data.cpu.p50)}</dd></div>
              <div><dt>CPU p99 (µs)</dt><dd className="u-numeric">{num(metrics.data.cpu.p99)}</dd></div>
            </dl>
            <p className={styles.quiet}>Fetched {metrics.data.fetchedAt ?? "unknown"}; retained for {metrics.data.retentionDays ?? "unknown"} days. Sampled script aggregates span app versions. Output lineage is unavailable.</p>
          </>
        )}
      </section>

      <section aria-labelledby="ops-measurements" className={styles.opsSection}>
        <h3 id="ops-measurements" className={styles.subhead}>Custom measurements</h3>
        {measurements.error && <p role="alert" className={styles.errorText}>{(measurements.error as Error).message}</p>}
        {measurementPage && (
          <>
            <p className={styles.quiet}>{measurementPage.state}{measurementPage.reason ? `: ${measurementPage.reason}` : ""}</p>
            {measurementRows.length ? (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.compact}`}>
                  <thead><tr><th>Name</th><th>Value</th><th>Time</th><th>Observed output lineage</th></tr></thead>
                  <tbody>
                    {measurementRows.map((m) => (
                      <tr key={m.seq}>
                        <td>{m.name}</td>
                        <td className="u-numeric">{m.value} {m.unit}</td>
                        <td><time dateTime={m.emittedAt}>{m.emittedAt}</time></td>
                        <td className={styles.quiet}>Artifact {m.artifactId}; build {m.buildId}; source {m.commit}; output {m.outputId ?? "unknown"}; Genome {m.genomeCommit ?? "unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.quiet}>{measurements.hasNextPage ? "No matching measurements on loaded pages; older retained events may contain more." : "No retained custom measurements in this window."}</p>
            )}
            {measurements.hasNextPage && (
              <Button disabled={measurements.isFetchingNextPage} onClick={() => void measurements.fetchNextPage()}>
                {measurements.isFetchingNextPage ? "Loading…" : "Load older measurements"}
              </Button>
            )}
          </>
        )}
      </section>

      {editing !== undefined ? (
        <FlagForm key={editing?.key ?? "new"} flag={editing} binding={binding} enabled={enabled} onBack={() => setEditing(undefined)} />
      ) : (
        <section aria-labelledby="ops-flags" className={styles.opsSection}>
          <div className={styles.opsHead}>
            <h3 id="ops-flags" className={styles.subhead}>Feature flags</h3>
            {flagPage && (
              <Button disabled={!["available", "partial"].includes(flagPage.state)} onClick={() => setEditing(null)}>Create boolean flag</Button>
            )}
          </div>
          {flags.isLoading && <p role="status" className={styles.quiet}>Loading flags…</p>}
          {flags.error && <p role="alert" className={styles.errorText}>{(flags.error as Error).message}</p>}
          {flagPage && (
            <>
              <p className={styles.quiet}>{flagPage.state}{flagPage.reason ? `: ${flagPage.reason}` : ""}</p>
              {flagRows.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.compact}`}>
                    <thead><tr><th>Key</th><th>State</th><th>Fallback</th><th>Targeting and rollout</th><th><span className="sr-only">Edit</span></th></tr></thead>
                    <tbody>
                      {flagRows.map((f) => (
                        <tr key={f.key}>
                          <td><code>{f.key}</code></td>
                          <td>{f.enabled ? "enabled" : "disabled"}</td>
                          <td>{f.default_variation}</td>
                          <td>
                            <details>
                              <summary>{f.rules.length} {f.rules.length === 1 ? "rule" : "rules"}</summary>
                              <pre className={styles.command} tabIndex={0}>{JSON.stringify(f.rules, null, 2)}</pre>
                            </details>
                          </td>
                          <td className={styles.links}><Button variant="ghost" size="compact" onClick={() => setEditing(f)}>Edit {f.key}</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {flags.hasNextPage && (
                <Button disabled={flags.isFetchingNextPage} onClick={() => void flags.fetchNextPage()}>{flags.isFetchingNextPage ? "Loading…" : "Load more flags"}</Button>
              )}
            </>
          )}
        </section>
      )}

      {audit.data && (
        <details className={styles.opsSection}>
          <summary>Operational change history</summary>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.compact}`}>
              <thead><tr><th>Time</th><th>Change</th><th>Status</th><th>Reason</th></tr></thead>
              <tbody>
                {audit.data.entries.map((e) => (
                  <tr key={e.id}><td>{e.at}</td><td>{e.operation} {e.key}</td><td>{e.status}</td><td>{e.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
