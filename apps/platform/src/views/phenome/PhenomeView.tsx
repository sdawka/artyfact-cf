import { Link, useSearchParams } from "react-router";
import type { Build, Deployment } from "../../../shared/api";
import { useBuilds, useDeployments, usePhenomeEventPages, useRealizedArtifacts } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { ThingScopeNote } from "@/components/ThingScope/ThingScopeNote";
import { Button } from "@/components/ui";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { useThingFilter } from "@/model/useThingFilter";
import { Unknown } from "@/components/Unknown/Unknown";
import { BuildsSection } from "./BuildsSection";
import { DeploymentsSection } from "./DeploymentsSection";
import { EventsSection } from "./EventsSection";
import { FilterChips } from "./FilterChips";
import { Operations } from "./Operations";
import { short, sortNewest, withSystemCommit } from "./lib";
import styles from "./phenome.module.css";

/** Builds, deployments, runtime events and observation criteria of the System's running app. */
export default function PhenomeView() {
  const [params] = useSearchParams();
  const href = useKeepParams();
  const filter = useThingFilter();
  const thingId = filter.thingId;
  const deployment = params.get("deployment") ?? undefined;
  const buildFilter = params.get("build") ?? undefined;
  const output = params.get("output") ?? undefined;
  const builds = useBuilds();
  const deployments = useDeployments();
  const events = usePhenomeEventPages({
    ...(deployment && { deployment }), ...(thingId && { thing: thingId }), ...(buildFilter && { build: buildFilter }), ...(output && { output }),
    ...(params.get("kind") && { kind: params.get("kind")! }), ...(params.get("commit") && { commit: params.get("commit")! }), ...(params.get("realization") && { realization: params.get("realization")! }),
  });
  const artifacts = useRealizedArtifacts();
  const list = sortNewest((builds.data ?? []).filter((build) => !thingId || (build.thingId ?? build.output?.thingId) === thingId));
  const outputIds = new Set((artifacts.data ?? []).filter((o) => o.thingId === thingId).map((o) => o.id));
  const belongs = (item: Deployment) => !thingId || (item.output !== undefined && outputIds.has(item.output)) || list.some((build) => build.id === item.build);
  const versions = events.data?.versions ?? [];
  const withCommit = (d: Deployment) => withSystemCommit(d, versions);
  const currentProduction = deployments.data?.production ?? null;
  const production = currentProduction && belongs(currentProduction) ? withCommit(currentProduction) : null;
  const history = (deployments.data?.history ?? []).filter(belongs).map(withCommit);
  const runtimeEvents = (events.data?.events ?? []).filter((event) => !thingId || event.thingId === thingId);
  const loading = builds.isLoading || deployments.isLoading;
  const failed = builds.isError || deployments.isError;
  const noData = !loading && !failed && list.length === 0 && history.length === 0 && !production;
  const rows = production && !history.some((d) => d.id === production.id) ? [production, ...history] : history;
  const selected = deployment ? rows.find((d) => d.id === deployment) : undefined;

  return (
    <div className={styles.view}>
      <PageHeader title="Deployments" purpose="Builds, deployments and what the running System reports." scopeNote={<ThingScopeNote filter={filter} />} />
      <div className={styles.scope}>
        <FilterChips />
      </div>
      {!loading && !failed && <ProductionSummary production={production} history={history} />}
      {noData ? (
        <EmptyState
          title="No builds or deployments yet."
          action={<Button asChild><Link to={href("review")}>Open Review</Link></Button>}
        >
          A build starts when a candidate is promoted or a preview is reported.
        </EmptyState>
      ) : (
        <>
          <BuildsSection builds={list} production={production} loading={builds.isLoading} error={builds.error} onRetry={() => void builds.refetch()} />
          <DeploymentsSection production={production} history={history} loading={deployments.isLoading} error={deployments.error} onRetry={() => void deployments.refetch()} />
        </>
      )}
      <EventsSection events={runtimeEvents} versions={versions} buildFilter={buildFilter} paging={events} deployments={rows} builds={list} noData={noData} />
      <CriteriaSection />
      {deployment && <ImplementationEvaluations deployment={selected} builds={list} />}
      <Operations thingId={thingId} />
    </div>
  );
}

/** The first thing to read: is production live, and at what. */
function ProductionSummary({ production, history }: { production: Deployment | null; history: Deployment[] }) {
  const href = useKeepParams();
  const live = production?.status === "live" ? production : history.find((d) => d.kind === "production" && d.status === "live");
  const failed = !live && history.find((d) => d.kind === "production" && d.status === "failed");
  return (
    <section aria-label="Production" className={styles.summary}>
      <h2 className={styles.summaryTitle}>Production</h2>
      {live ? (
        <MetaLine items={[
          { value: live.url ? <a href={live.url} target="_blank" rel="noopener noreferrer">{live.url}</a> : <Unknown /> , label: "Live at" },
          { label: "Commit", value: short(live.commit), code: true },
          ...(live.systemCommit ? [{ label: "System commit", value: <Link to={href("changelog", { commit: live.systemCommit })}>{live.systemCommit}</Link> }] : []),
        ]} />
      ) : failed ? (
        <StatusText status="failed" label="Last production deploy failed" tone="fail" />
      ) : (
        <span>not deployed</span>
      )}
    </section>
  );
}

/** Observation criteria and their reading: always unknown today. Hidden when the System has none. */
function CriteriaSection() {
  const m = useModel();
  const crits = m.bundle.model.criteria.filter((c) => c.targetKind === "observation");
  if (crits.length === 0) return null;
  return (
    <Section title="Outcome criteria" description="Runtime outcome evaluation is not available. Observations are listed separately and do not establish verdicts.">
      <ul className={styles.critList}>
        {crits.map((c) => (
          <li key={c.id}><NodeChip id={c.id} size="sm" glyph={false} /> <StatusText status="unknown" glyph="" /></li>
        ))}
      </ul>
    </Section>
  );
}

/** Implementation checks for the selected deployment's build candidate (not runtime outcome verdicts). */
function ImplementationEvaluations({ deployment, builds }: { deployment?: Deployment; builds: Build[] }) {
  const m = useModel();
  const build = deployment?.build ? builds.find((b) => b.id === deployment.build && b.commit === deployment.commit && (!deployment.output || b.output?.id === deployment.output) && (!b.source || b.source.repo === deployment.repo)) : undefined;
  const evaluations = build?.candidate ? m.evaluations.filter((e) => e.candidate === build.candidate) : [];
  return (
    <Section title="Implementation evaluations" description="Candidate, Genome and preview evaluations describe implementation checks; they are not runtime outcome verdicts.">
      {!build?.candidate ? (
        <p className={styles.quiet}>No implementation evaluations are associated with this deployment's build.</p>
      ) : evaluations.length === 0 ? (
        <p className={styles.quiet}>No implementation evaluations for this deployment.</p>
      ) : (
        <ul className={styles.critList}>
          {evaluations.map((e) => (
            <li key={e.id}><code>{e.id}</code> <NodeChip id={e.criterion} size="sm" glyph={false} /> <VerdictBadge verdict={e.execution === "completed" ? e.verdict : "unknown"} /></li>
          ))}
        </ul>
      )}
    </Section>
  );
}
