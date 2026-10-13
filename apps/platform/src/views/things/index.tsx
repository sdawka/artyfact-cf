import { Link, useParams } from "react-router";
import { usePhenomeEvents, useRealizedArtifacts } from "@/api/queries";
import { Card } from "@/components/Card/Card";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { KeyValue } from "@/components/KeyValue/KeyValue";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSystemRoute, viewPath } from "@/model/useSelection";
import styles from "./things.module.css";

const Unknown = () => <span className={styles.unknown}>unknown</span>;
const short = (value: string) => value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;

/** Read-only workspace for one Thing. It keeps the System shell available while making the Thing boundary explicit. */
export default function ThingWorkspace() {
  const { thingId } = useParams();
  const { systemId, rev } = useSystemRoute();
  const href = useKeepParams();
  const { bundle } = useModel();
  const thing = bundle.model.things.find((candidate) => candidate.id === thingId);
  const artifacts = useRealizedArtifacts();
  const events = usePhenomeEvents();
  if (!thing) {
    return <EmptyState title="This Thing is not in the selected System revision." action={<Link className="u-marker" to={viewPath(systemId, rev, "overview")}>Open System overview</Link>} />;
  }
  const outputs = (artifacts.data ?? []).filter((output) => output.thingId === thing.id);
  const evidence = (events.data?.events ?? []).filter((event) => event.thingId === thing.id);
  const otherThings = bundle.model.things.filter((candidate) => candidate.id !== thing.id);
  const parts = thing.parts ?? [];
  const sourceArtifacts = thing.artifacts ?? [];
  return (
    <section className={styles.view} aria-labelledby="thing-title">
      <nav className={styles.crumbs} aria-label="Thing workspace breadcrumb">
        <Link className="u-marker" to={viewPath(systemId, rev, "overview")}>{bundle.model.system.name}</Link>
        <span aria-hidden="true">/</span>
        <span>Thing workspace</span>
      </nav>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Thing</p>
          <h1 id="thing-title">{thing.name}</h1>
          <p className={styles.description}>{thing.description || "Genome-first Thing"}</p>
        </div>
        <Link className="u-marker" to={viewPath(systemId, rev, "overview")}>System overview</Link>
      </header>
      {otherThings.length > 0 && (
        <nav className={styles.switcher} aria-label="Things in this System">
          <span>Things</span>
          <Link aria-current="page" to={`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/things/${encodeURIComponent(thing.id)}`}>{thing.name}</Link>
          {otherThings.map((candidate) => <Link key={candidate.id} to={`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/things/${encodeURIComponent(candidate.id)}`}>{candidate.name}</Link>)}
        </nav>
      )}
      <nav className={styles.switcher} aria-label="Thing views">
        <Link className="u-marker" to={href("map", { focus: thing.id })}>Map</Link>
        <Link className="u-marker" to={href("code")}>Code</Link>
        <Link className="u-marker" to={href("work")}>Work</Link>
        <Link className="u-marker" to={href("phenome")}>Deployments</Link>
      </nav>
      <div className={styles.grid}>
        <Card title="Genome and composition" headingLevel={2}>
          <KeyValue data={{ id: thing.id, template: thing.templateRef, parts, composition: thing.composition }} />
          {parts.length === 0 && <p className={styles.muted}>No pinned Parts. This Thing can be Genome-only.</p>}
          <p className={styles.muted}>Author or compose Parts with the CLI or an agent; this workspace only inspects saved state.</p>
        </Card>
        <Card title="Source artifacts" headingLevel={2}>
          {sourceArtifacts.length === 0 ? <p className={styles.muted}>No source artifacts recorded — <Unknown />.</p> : <KeyValue data={{ artifacts: sourceArtifacts }} />}
        </Card>
      </div>
      <Card title="Realized outputs" headingLevel={2}>
        {artifacts.isLoading ? <p className={styles.muted}>Loading realized outputs…</p> : artifacts.isError ? <p className={styles.error}>Could not load realized outputs.</p> : outputs.length === 0 ? <p className={styles.muted}>No realized outputs for this Thing. Source and realized output are distinct.</p> : (
          <ul className={styles.list}>{outputs.map((output) => <li key={output.id}><code>{output.id}</code><span>Source {output.source.repo}@{short(output.source.commit)}</span><span>Genome {short(output.genomeCommit)}</span><span>Build {output.build}</span>{output.locator ? <span>{output.locator}</span> : <Unknown />}</li>)}</ul>
        )}
      </Card>
      <Card title="Phenome evidence" headingLevel={2}>
        {events.isLoading ? <p className={styles.muted}>Loading runtime evidence…</p> : events.isError ? <p className={styles.error}>Could not load runtime evidence.</p> : evidence.length === 0 ? <p className={styles.muted}>No runtime evidence for this Thing — <Unknown />.</p> : <ul className={styles.list}>{evidence.map((event) => <li key={event.seq}><code>{event.kind}</code><span>{event.outputId ? `Output ${event.outputId}` : "Output unknown"}</span><span>{event.genomeCommit ? `Genome ${short(event.genomeCommit)}` : "Genome unknown"}</span><Link className="u-marker" to={href("phenome")}>Open deployments</Link></li>)}</ul>}
      </Card>
    </section>
  );
}
