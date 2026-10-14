import { useSearchParams } from "react-router";
import type { Build, Deployment, PhenomeEvent, PhenomeEventsResponse } from "../../../shared/api";
import { phenomeVersionKey } from "../../../shared/phenome";
import { Button, Select } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { Section } from "@/components/Section/Section";
import { Unknown } from "@/components/Unknown/Unknown";
import type { usePhenomeEventPages } from "@/api/queries";
import { FILTERS, useSetFilter } from "./FilterChips";
import { plural, short } from "./lib";
import { ExpandRow, When } from "./tables";
import styles from "./phenome.module.css";

const EXAMPLE = `curl -X POST "$PLATFORM/api/systems/$SYSTEM/phenome/events" \\
  -H "Authorization: Bearer $INGEST_TOKEN" -H "content-type: application/json" \\
  -d '{"events":[{"systemId":"…","thingId":"…","artifactId":"…","buildId":"<runtime build id>","commit":"<source commit>","emittedAt":"<ISO time>","kind":"journey.step","payload":{}}]}'`;

/** The ingest request an app sends, on a well, with Copy. The empty state's next step. */
function IngestExample() {
  return (
    <div className={styles.well}>
      <div className={styles.wellHead}>
        <span className={styles.quiet}>Your app reports events to the ingest endpoint:</span>
        <CopyButton value={EXAMPLE} label="Copy example" />
      </div>
      <pre className={styles.command} tabIndex={0} aria-label="Example ingest request">{EXAMPLE}</pre>
    </div>
  );
}

export function EventsSection({ events, versions, buildFilter, paging, deployments, builds, noData }: {
  events: PhenomeEvent[];
  versions: PhenomeEventsResponse["versions"];
  buildFilter: string | undefined;
  paging: ReturnType<typeof usePhenomeEventPages>;
  deployments: Deployment[];
  builds: Build[];
  /** The page is empty (no builds or deployments): the example is the whole point of this section. */
  noData: boolean;
}) {
  const [params] = useSearchParams();
  const set = useSetFilter();
  const filtered = FILTERS.some(([key]) => params.get(key));
  const shown = buildFilter ? events.filter((e) => e.buildId === buildFilter) : events;
  const keyOf = (e: PhenomeEvent) => phenomeVersionKey(e.outputId, e.buildId, e.commit);
  const keys = [...new Set(shown.map(keyOf))];
  const kinds = [...new Set(events.map((e) => e.kind))];
  const runtimeBuilds = [...new Set(events.map((e) => e.buildId))];
  const opt = (value: string, all: string, items: readonly string[]) => [{ value: "", label: all }, ...items.map((v) => ({ value: v, label: v }))];
  const empty = !paging.isLoading && !paging.error && shown.length === 0;
  return (
    <Section title="Runtime events">
      {!noData && (
        <div className={styles.filters} role="group" aria-label="Event filters">
          <div className={styles.filter}>
            <span>Deployment</span>
            <Select aria-label="Deployment" value={params.get("deployment") ?? ""} onChange={(v) => set("deployment", v || null)} options={opt("", "All deployments", deployments.map((d) => d.id))} />
          </div>
          <div className={styles.filter}>
            <span>Build</span>
            <Select aria-label="Build" value={params.get("build") ?? ""} onChange={(v) => set("build", v || null)} options={opt("", "All builds", [...new Set([...runtimeBuilds, ...builds.map((b) => b.buildId).filter((b): b is string => !!b)])])} />
          </div>
          <div className={styles.filter}>
            <span>Kind</span>
            <Select aria-label="Kind" value={params.get("kind") ?? ""} onChange={(v) => set("kind", v || null)} options={opt("", "All kinds", kinds)} />
          </div>
        </div>
      )}
      {paging.isLoading && <p role="status" className={styles.quiet}>Loading runtime events…</p>}
      {paging.error && (
        <EmptyState
          kind="error"
          title={paging.isFetchNextPageError ? "Could not load older events." : "Could not load runtime events."}
          action={<Button disabled={paging.isFetching} onClick={() => void (paging.isFetchNextPageError ? paging.fetchNextPage() : paging.refetch())}>{paging.isFetchNextPageError ? "Retry older events" : "Retry runtime events"}</Button>}
        >
          {paging.error.message}
        </EmptyState>
      )}
      {empty && (filtered ? (
        <p className={styles.quiet}>No runtime events match these filters.</p>
      ) : (
        <>
          <p className={styles.quiet}>No runtime events yet.</p>
          <IngestExample />
        </>
      ))}
      {keys.map((k) => {
        const group = shown.filter((e) => keyOf(e) === k);
        if (group.length === 0) return null;
        const v = versions.find((x) => x.key === k);
        return (
          <details key={k} className={styles.group}>
            <summary>
              <span className={styles.groupHead}>
                <span className={styles.groupTitle}>{[...new Set(group.map((e) => e.kind))].join(", ")}</span>
                <span className={styles.groupMeta}>{v ? plural(v.count, "event") : plural(group.length, "loaded event")}</span>
                <span className={styles.groupMeta}><span className={styles.label}>Output</span> {v?.output ?? group[0]!.outputId ? <code>{v?.output ?? group[0]!.outputId}</code> : <Unknown />}</span>
                <span className={styles.groupMeta}><span className={styles.label}>Runtime build</span> <code>{short(group[0]!.buildId)}</code></span>
                <span className={styles.groupMeta}><span className={styles.label}>Source</span> <code>{short(group[0]!.commit)}</code></span>
                <span className={styles.groupMeta}><span className={styles.label}>Genome</span> {v?.genomeCommit ? <code>{short(v.genomeCommit)}</code> : <Unknown />}</span>
                {v?.systemCommit && <span className={styles.groupMeta}><span className={styles.label}>System commit</span> <code>{v.systemCommit}</code></span>}
              </span>
            </summary>
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.compact} ${styles.stack}`}>
                <thead><tr><th className={styles.toggleCell}><span className="sr-only">Details</span></th><th>Time</th><th>Kind</th><th>Subject</th><th>Criterion</th></tr></thead>
                <tbody>{group.map((e) => <EventRow key={e.seq} e={e} />)}</tbody>
              </table>
            </div>
          </details>
        );
      })}
      {paging.hasNextPage && !paging.isFetchNextPageError && (
        <Button disabled={paging.isFetchingNextPage} onClick={() => void paging.fetchNextPage()}>
          {paging.isFetchingNextPage ? "Loading older events…" : "Load older events"}
        </Button>
      )}
      {paging.data && !paging.hasNextPage && shown.length > 0 && <p className={styles.quiet}>All retained events in this scope are loaded.</p>}
    </Section>
  );
}

function EventRow({ e }: { e: PhenomeEvent }) {
  const { seq: _s, receivedAt: _r, realization: _z, ...header } = e;
  return (
    <ExpandRow
      id={`event-${e.seq}`}
      label={`${e.kind} event ${e.seq}`}
      columns={4}
      cells={<>
        <td><When iso={e.emittedAt} /></td>
        <td><code>{e.kind}</code></td>
        <td className={styles.line2} data-label={e.subject ? "Subject" : undefined}>{e.subject ? <NodeChip id={e.subject} size="sm" /> : null}</td>
        <td className={styles.line2} data-label={e.criterion ? "Criterion" : undefined}>{e.criterion ? <NodeChip id={e.criterion} size="sm" /> : null}</td>
      </>}
    >
      <pre className={styles.command} aria-label="Raw event">{JSON.stringify(header, null, 2)}</pre>
    </ExpandRow>
  );
}
