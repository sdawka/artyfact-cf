import { Operations } from "./Operations";
import { Link, useParams, useSearchParams } from "react-router";
import type { Build, Deployment, PhenomeEvent, PhenomeEventsResponse } from "../../../shared/api";
import { phenomeVersionKey } from "../../../shared/phenome";
import { useAdminToken } from "@/api/adminToken";
import { useBuilds, useDeployments, usePhenomeEventPages, useRealizedArtifacts } from "@/api/queries";
import { Button } from "@/components/ui";
import { Card } from "@/components/Card/Card";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { buildTone, StatusChip } from "@/components/StatusChip/StatusChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSystemRoute } from "@/model/useSelection";
import { BUILD_GLYPH, short, sortNewest, stamp } from "./lib";
import styles from "./phenome.module.css";

const EXAMPLE = `curl -X POST "$PLATFORM/api/systems/$SYSTEM/phenome/events" \\
  -H "Authorization: Bearer $INGEST_TOKEN" -H "content-type: application/json" \\
  -d '{"events":[{"systemId":"…","thingId":"…","artifactId":"…","buildId":"<runtime build id>","commit":"<source commit>","emittedAt":"<ISO time>","kind":"journey.step","payload":{}}]}'`;

const Unknown = () => <span className={styles.unknown}>unknown</span>;
const When = ({ iso }: { iso?: string | null }) => (iso ? <time dateTime={iso}>{stamp(iso)}</time> : <Unknown />);

/** Builds, deployments, runtime events and observation criteria of the System's running app. */
export default function PhenomeView() {
  const [params] = useSearchParams();
  const { thingId } = useParams();
  const deployment = params.get("deployment") ?? undefined;
  const buildFilter = params.get("build") ?? undefined;
  const builds = useBuilds();
  const deployments = useDeployments();
  const output = params.get("output") ?? undefined;
  const events = usePhenomeEventPages({ ...(deployment && { deployment }), ...(thingId && { thing: thingId }), ...(buildFilter && { build: buildFilter }), ...(output && { output }), ...(params.get("kind") && { kind: params.get("kind")! }), ...(params.get("commit") && { commit: params.get("commit")! }), ...(params.get("realization") && { realization: params.get("realization")! }) });
  const artifacts = useRealizedArtifacts();
  const list = sortNewest((builds.data ?? []).filter((build) => !thingId || (build.thingId ?? build.output?.thingId) === thingId));
  const outputIds = new Set((artifacts.data ?? []).filter((output) => output.thingId === thingId).map((output) => output.id));
  const belongs = (item: Deployment) => !thingId || (item.output !== undefined && outputIds.has(item.output)) || list.some((build) => build.id === item.build);
  const currentProduction = deployments.data?.production ?? null;
  const production = currentProduction && belongs(currentProduction) ? currentProduction : null;
  const history = (deployments.data?.history ?? []).filter(belongs);
  const runtimeEvents = (events.data?.events ?? []).filter((event) => !thingId || event.thingId === thingId);
  const versions = events.data?.versions ?? [];
  const { token: adminToken } = useAdminToken();
  const empty = !builds.isLoading && !deployments.isLoading && list.length === 0 && history.length === 0 && !production;
  return (
    <section className={styles.view} aria-labelledby="view-title">
      <h1 id="view-title">Deployments</h1>
      {!adminToken && <p className={styles.muted} role="note">Admin actions need the admin token: set it in the header.</p>}
      {empty && <p className={styles.muted}>No deployments recorded — <Unknown />.</p>}
      <Operations />
      <BuildsCard builds={list} production={production} />
      <DeploymentsCard production={production} history={history} />
      <EventsCard events={runtimeEvents} versions={versions} buildFilter={buildFilter} deployment={deployment} paging={events} />
      <CriteriaCard />
      <ImplementationEvaluationsCard deployment={history.find(d => d.id === deployment) ?? (production?.id === deployment ? production ?? undefined : undefined)} builds={list} />
    </section>
  );
}

function BuildsCard({ builds, production }: { builds: Build[]; production: Deployment | null }) {
  const href = useKeepParams();
  return (
    <section aria-labelledby="builds-title" className={styles.plain}>
      <h2 id="builds-title" className={styles.heading}>Builds</h2>
      {builds.length === 0 ? <p className={styles.muted}>No builds yet — <Unknown />.</p> : (
        <ul className={styles.list}>
          {builds.map((b) => (
            <Card as="li" key={b.id}>
              <div className={styles.row}>
                <StatusChip status={b.status} tone={buildTone(b.status)} glyph={BUILD_GLYPH[b.status]} />
                <span>{b.kind}</span>
                <code>{short(b.commit)}</code>
                <span>Output {b.output ? <code>{b.output.id}</code> : "unknown"}</span>
                {b.output && <span className={styles.muted}>Source {b.output.source.repo}@{short(b.output.source.commit)} · Genome {short(b.output.genomeCommit)}</span>}
                {b.candidate && <code>{b.candidate}</code>}
                {b.realization && <Link className="u-marker" to={href("work", { realization: b.realization })}>{b.realization}</Link>}
                {b.url && <a className="u-marker" href={b.url} target="_blank" rel="noopener noreferrer">Preview</a>}
                {b.logsUrl && <a className="u-marker" href={b.logsUrl} target="_blank" rel="noopener noreferrer">Logs</a>}
                <span className={styles.muted}>started <When iso={b.startedAt} /> · finished <When iso={b.finishedAt} /></span>
                {production && b.kind === "production" && production.build === b.id && production.systemCommit &&
                  <span className={styles.muted}>represents {production.systemCommit}</span>}
              </div>
              {b.steps && b.steps.length > 0 && (
                <ul className={styles.steps} aria-label={`Steps of ${b.id}`}>
                  {b.steps.map((s) => <li key={s.name} className={styles.step} data-status={s.status}>{s.name}: {s.status}</li>)}
                </ul>
              )}
              {b.error && <p className={styles.muted}>{b.error}</p>}
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeploymentsCard({ production, history }: { production: Deployment | null; history: Deployment[] }) {
  const href = useKeepParams();
  const rows = production && !history.some((d) => d.id === production.id) ? [production, ...history] : history;
  return (
    <Card title="Deployments" headingLevel={2}>
      {rows.length === 0 ? <p className={styles.muted}>No deployments yet — <Unknown />.</p> : (
        <ul className={styles.list}>
          {rows.map((d) => (
            <li key={d.id} className={styles.row}>
              <StatusChip status={d.status} label={d.status} tone="neutral" />
              <span>{d.kind}</span>
              <span>Output {d.output ? <code>{d.output}</code> : "unknown"}</span>
              <code>{short(d.commit)}</code>
              {d.url ? <a className="u-marker" href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a> : <Unknown />}
              <span className={styles.muted}>buildId <code>{d.buildId ? short(d.buildId) : "unknown"}</code></span>
              {d.systemCommit && <Link className="u-marker" to={href("changelog", { commit: d.systemCommit })}>{d.systemCommit}</Link>}
              <Link className="u-marker" to={href("phenome", { deployment: d.id })}>Events</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventsCard({ events, versions, buildFilter, deployment, paging }: {
  events: PhenomeEvent[];
  versions: PhenomeEventsResponse["versions"];
  buildFilter: string | undefined;
  deployment: string | undefined;
  paging: ReturnType<typeof usePhenomeEventPages>;
}) {
  const shown = buildFilter ? events.filter((e) => e.buildId === buildFilter) : events;
  const keyOf = (e: PhenomeEvent) => phenomeVersionKey(e.outputId, e.buildId, e.commit);
  const keys = [...new Set(shown.map(keyOf))];
  return (
    <Card title="Runtime events" headingLevel={2}>
      {deployment && <p className={styles.muted}>Deployment <code>{deployment}</code></p>}
      {paging.isLoading && <p role="status">Loading runtime events…</p>}
      {paging.error && <div role="alert"><p>{paging.isFetchNextPageError ? "Could not load older events" : "Could not load runtime events"}: {paging.error.message}</p><Button variant="secondary" disabled={paging.isFetching} onClick={() => void (paging.isFetchNextPageError ? paging.fetchNextPage() : paging.refetch())}>{paging.isFetchNextPageError ? "Retry older events" : "Retry runtime events"}</Button></div>}
      {!paging.isLoading && !paging.error && shown.length === 0 ? (
        <>
          <p className={styles.muted}>No runtime events in this scope.</p>
          <pre className={styles.raw} tabIndex={0} aria-label="Example ingest request">{EXAMPLE}</pre>
        </>
      ) : keys.map((k) => {
        const group = shown.filter((e) => keyOf(e) === k);
        if (group.length === 0) return null;
        const v = versions.find((x) => x.key === k);
        return (
          <details key={k} className={styles.group}>
            <summary>
              <code>{short(group[0].outputId ?? group[0].buildId)}</code> · {v ? `${v.count} events` : `${group.length} loaded events`} · Source {short(group[0].commit)} · Output {v?.output ? <code>{v.output}</code> : "unknown"} · Genome {v?.genomeCommit ? short(v.genomeCommit) : "unknown"}{v?.systemCommit ? ` · ${v.systemCommit}` : ""}
            </summary>
            <ul className={styles.list}>{group.map((e) => <EventRow key={e.seq} e={e} />)}</ul>
          </details>
        );
      })}
      {paging.hasNextPage && !paging.isFetchNextPageError && <Button variant="secondary" disabled={paging.isFetchingNextPage} onClick={() => void paging.fetchNextPage()}>{paging.isFetchingNextPage ? "Loading older events…" : "Load older events"}</Button>}
      {paging.data && !paging.hasNextPage && shown.length > 0 && <p className={styles.muted}>All retained events in this scope are loaded.</p>}
    </Card>
  );
}

function EventRow({ e }: { e: PhenomeEvent }) {
  const { seq: _s, receivedAt: _r, realization: _z, ...header } = e;
  return (
    <li>
      <details className={styles.event}>
        <summary>
          <When iso={e.emittedAt} /> · <code>{e.kind}</code>
          {e.subject && <> · <NodeChip id={e.subject} size="sm" /></>}
          {e.criterion && <> · <NodeChip id={e.criterion} size="sm" /></>}
        </summary>
        <pre className={styles.raw}>{JSON.stringify(header, null, 2)}</pre>
      </details>
    </li>
  );
}

function CriteriaCard() {
  const { thingId } = useParams();
  const m = useModel();
  const crits = m.bundle.model.criteria.filter((c) => c.targetKind === "observation");
  return (
    <Card title={thingId ? "System outcome criteria" : "Outcome criteria"} headingLevel={2}>
      <p className={styles.muted}>Runtime outcome evaluation is not available. Observations are listed separately and do not establish verdicts.</p>
      {crits.length === 0 ? <p className={styles.muted}>No observation criteria — <Unknown />.</p> : (
        <ul className={styles.list}>
          {crits.map((c) => {
            return (
              <li key={c.id} className={styles.crit}>
                <NodeChip id={c.id} size="sm" />
                <Unknown />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


function ImplementationEvaluationsCard({deployment,builds}:{deployment?:Deployment;builds:Build[]}) {
 const m=useModel();
 const build=deployment?.build ? builds.find(b=>b.id===deployment.build && b.commit===deployment.commit && (!deployment.output || b.output?.id===deployment.output) && (!b.source || b.source.repo===deployment.repo)) : undefined;
 const evaluations=build?.candidate ? m.evaluations.filter(e=>e.candidate===build.candidate) : [];
 return <Card title="Implementation evaluations" headingLevel={2}>
  <p className={styles.muted}>Candidate, Genome and preview evaluations describe implementation checks; they are not runtime outcome verdicts.</p>
  {!build?.candidate ? <p className={styles.muted}>No exact deployment → build → candidate association.</p> : evaluations.length===0 ? <p className={styles.muted}>No implementation evaluations for this deployment.</p> : <ul className={styles.list}>{evaluations.map(e=><li key={e.id}><code>{e.id}</code> · <NodeChip id={e.criterion} size="sm" glyph={false}/> · <VerdictBadge verdict={e.execution==='completed'?e.verdict:'unknown'}/></li>)}</ul>}
 </Card>;
}
