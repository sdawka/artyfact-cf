import { Link, useNavigate } from "react-router";
import { usePhenomeEvents, useRealizedArtifacts } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Facts } from "@/components/Facts/Facts";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { Button, Select } from "@/components/ui";
import { Unknown } from "@/components/Unknown/Unknown";
import { LAYER_QUESTIONS } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { thingPath, useKeepParams, useSystemRoute, viewPath } from "@/model/useSelection";
import { useThingFilter } from "@/model/useThingFilter";
import styles from "./things.module.css";

const short = (value: string) => (value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value);

/** Read-only workspace for one Thing: its Genome definition, source, realized output and runtime evidence. */
export default function ThingWorkspace() {
  const { systemId, rev } = useSystemRoute();
  const href = useKeepParams();
  const navigate = useNavigate();
  const { bundle } = useModel();
  const { thing: scoped } = useThingFilter();
  const thing = scoped && bundle.model.things.find((t) => t.id === scoped.id);
  const artifacts = useRealizedArtifacts();
  const events = usePhenomeEvents();
  // ThingBoundary has already rejected an unknown Thing.
  if (!thing) return null;
  const outputs = (artifacts.data ?? []).filter((output) => output.thingId === thing.id);
  const evidence = (events.data?.events ?? []).filter((event) => event.thingId === thing.id);
  const parts = thing.parts ?? [];
  const sourceArtifacts = thing.artifacts ?? [];
  const things = bundle.model.things;
  const outputKnown = !artifacts.isLoading && !artifacts.isError;
  return (
    <div className={styles.view}>
      <PageHeader
        title={thing.name}
        purpose={thing.description || "No description."}
        context={
          <div className={styles.context}>
            <Link to={viewPath(systemId, rev, "overview")}>{bundle.model.system.name}</Link>
            <span aria-hidden="true" className={styles.sep}>/</span>
            <Select
              aria-label="Thing"
              value={thing.id}
              onChange={(id) => void navigate(thingPath(systemId, rev, id))}
              options={things.map((t) => ({ value: t.id, label: t.name || t.id }))}
            />
          </div>
        }
        status={outputKnown ? <StatusChip status="output" label={outputs.length ? `Output: ${outputs.length} realized` : "Output: none yet"} /> : undefined}
        primary={<Button asChild variant="primary"><Link to={href("work", { panel: "intent", anchor: thing.id })}>Describe a change</Link></Button>}
        secondary={<Button asChild><Link to={href("map")}>Map</Link></Button>}
      />

      <Section title="Genome" description={`${LAYER_QUESTIONS.genome}? This page shows saved state; author or compose Parts with the CLI or an agent.`}>
        <Facts>
          <dt>Id</dt><dd><code>{thing.id}</code></dd>
          <dt>Template</dt><dd>{thing.templateRef ? <code>{thing.templateRef}</code> : <Unknown>none</Unknown>}</dd>
          <dt>Parts</dt>
          <dd>
            {parts.length === 0 ? "none (Genome-only)" : (
              <ul className={styles.plain}>{parts.map((p) => <li key={p.contribution}><code>{p.contribution}</code> {typeof p.part === "string" ? <code>{p.part}</code> : <code>{JSON.stringify(p.part)}</code>}</li>)}</ul>
            )}
          </dd>
          {thing.composition && <><dt>Composition</dt><dd><code>{thing.composition.recipe}</code> <span className={styles.quiet}>({thing.composition.packages.length} {thing.composition.packages.length === 1 ? "package" : "packages"})</span></dd></>}
        </Facts>
      </Section>

      <Section title="Source" description="The repositories and paths this Thing is implemented in.">
        {sourceArtifacts.length === 0 ? (
          <EmptyState title="No source artifacts yet.">Artifacts are declared on the Thing in the Genome.</EmptyState>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Artifact</th><th>Type</th><th>Repo</th><th>Scope</th></tr></thead>
              <tbody>
                {sourceArtifacts.map((a) => (
                  <tr key={a.artifact}>
                    <td><code>{a.artifact}</code></td>
                    <td>{a.type}</td>
                    <td>{a.repo ? <code>{a.repo}</code> : <Unknown />}</td>
                    <td>{a.scope?.length ? a.scope.map((s) => <code key={s} className={styles.scopePath}>{s}</code>) : <Unknown>whole repo</Unknown>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Realized outputs" description={`${LAYER_QUESTIONS.proteome}? Source and realized output are distinct.`}>
        {artifacts.isLoading ? (
          <p role="status" className={styles.quiet}>Loading realized outputs…</p>
        ) : artifacts.isError ? (
          <EmptyState kind="error" title="Could not load realized outputs." onRetry={() => void artifacts.refetch()}>{artifacts.error.message}</EmptyState>
        ) : outputs.length === 0 ? (
          <EmptyState title="No realized output yet." action={<Button asChild><Link to={href("work")}>Open Work</Link></Button>}>
            A Realization produces one when its candidate is promoted.
          </EmptyState>
        ) : (
          <RowList label="Realized outputs">
            {outputs.map((output) => (
              <Row
                key={output.id}
                to={href("phenome", { output: output.id })}
                title={<code>{output.id}</code>}
                meta={<MetaLine items={[
                  { label: "Source", value: `${output.source.repo}@${short(output.source.commit)}` },
                  { label: "Genome", value: short(output.genomeCommit) },
                  { label: "Build", value: output.build, code: true },
                  { label: "Locator", value: output.locator ?? <Unknown /> },
                ]} />}
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section
        title="Phenome evidence"
        description={`${LAYER_QUESTIONS.phenome}?`}
        actions={evidence.length > 0 ? <Link to={href("phenome")}>Open Deployments</Link> : undefined}
      >
        {events.isLoading ? (
          <p role="status" className={styles.quiet}>Loading runtime evidence…</p>
        ) : events.isError ? (
          <EmptyState kind="error" title="Could not load runtime evidence." onRetry={() => void events.refetch()}>{events.error.message}</EmptyState>
        ) : evidence.length === 0 ? (
          <EmptyState title="No runtime evidence yet." action={<Button asChild><Link to={href("phenome")}>Open Deployments</Link></Button>}>
            Evidence arrives from the running app.
          </EmptyState>
        ) : (
          <RowList label="Runtime evidence" density="compact">
            {evidence.map((event) => (
              <Row
                key={event.seq}
                title={<code>{event.kind}</code>}
                meta={<MetaLine items={[
                  { label: "Output", value: event.outputId ?? <Unknown />, code: !!event.outputId },
                  { label: "Genome", value: event.genomeCommit ? short(event.genomeCommit) : <Unknown /> },
                ]} />}
              />
            ))}
          </RowList>
        )}
      </Section>

      <nav aria-label="Related views" className={styles.related}>
        <h2 className={styles.relatedTitle}>Related views</h2>
        <ul>
          {(["work", "review", "code", "phenome"] as const).map((view) => (
            <li key={view}><Link to={href(view)}>{{ work: "Work", review: "Review", code: "Code", phenome: "Deployments" }[view]} for {thing.name}</Link></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
