import type { PartRecord } from "../../../shared/api";
import { Card } from "@/components/Card/Card";
import { KeyValue } from "@/components/KeyValue/KeyValue";
import styles from "./parts.module.css";

export function PartContents({ part }: { part: PartRecord }) {
  const pkg = part.package;
  return <>
    <header className={styles.header}><div><h2>{pkg.name || pkg.id}</h2><p>{pkg.description || "Immutable reusable package"}</p></div><code>{pkg.id}@{pkg.version}</code></header>
    <div className={styles.grid}>
      <Card title="Provenance" headingLevel={3}><KeyValue data={{ scope: part.scope, digest: part.digest, publishedAt: part.publishedAt, visibility: pkg.visibility }} /></Card>
      <Card title="Dependencies and inputs" headingLevel={3}><KeyValue data={{ dependencies: pkg.recipe?.contributions.map((contribution) => contribution.part), inputs: pkg.inputs, recipe: pkg.recipe }} /></Card>
    </div>
    <Card title="Pinned payload" headingLevel={3}><KeyValue data={{ payload: pkg.payload }} /></Card>
    <Card title="Saved commands" headingLevel={3}><KeyValue data={{ commands: pkg.commands }} /><p className={styles.note}>Commands are saved instructions. This page does not run them.</p></Card>
  </>;
}
