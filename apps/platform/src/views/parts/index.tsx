import { Link, useParams } from "react-router";
import { usePart } from "@/api/queries";
import { Card } from "@/components/Card/Card";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { KeyValue } from "@/components/KeyValue/KeyValue";
import { LoadingState } from "@/components/LoadingState/LoadingState";
import { HomeHeader } from "@/views/home/HomeHeader";
import styles from "./parts.module.css";

/** Public, read-only inspection of one immutable shared Part version. */
export default function PartDetail() {
  const { partId = "", version = "" } = useParams();
  const query = usePart(partId, version);
  if (query.isLoading) return <div className={styles.page}><HomeHeader /><main className={styles.main}><LoadingState label="Loading Part…" /></main></div>;
  if (query.isError || !query.data) return <div className={styles.page}><HomeHeader /><main className={styles.main}><EmptyState title="This Part could not be loaded." action={<Link className="u-marker" to="/">Open Home</Link>} /></main></div>;
  const part = query.data.part;
  const pkg = part.package;
  return (
    <div className={styles.page}>
      <HomeHeader />
      <main className={styles.main} tabIndex={-1}>
        <nav className={styles.crumbs} aria-label="Part breadcrumb"><Link className="u-marker" to="/">Home</Link><span aria-hidden="true">/</span><span>Reusable Part</span></nav>
        <header className={styles.header}><div><p className={styles.kicker}>Pinned Part</p><h1>{pkg.name || pkg.id}</h1><p>{pkg.description || "Immutable reusable package"}</p></div><code>{pkg.id}@{pkg.version}</code></header>
        <div className={styles.grid}>
          <Card title="Provenance" headingLevel={2}><KeyValue data={{ scope: part.scope.kind, digest: part.digest, publishedAt: part.publishedAt, visibility: pkg.visibility }} /></Card>
          <Card title="Dependencies and inputs" headingLevel={2}><KeyValue data={{ dependencies: pkg.recipe?.contributions.map((contribution) => contribution.part), inputs: pkg.inputs, recipe: pkg.recipe }} /></Card>
        </div>
        <Card title="Pinned payload" headingLevel={2}><KeyValue data={{ payload: pkg.payload }} /></Card>
        <Card title="Saved commands" headingLevel={2}><KeyValue data={{ commands: pkg.commands }} /><p className={styles.note}>Commands are saved instructions. This page does not run them.</p></Card>
        <p className={styles.note}>Parts are authored, composed, and upgraded through the CLI or an agent. The browser only shows this saved package version.</p>
      </main>
    </div>
  );
}
