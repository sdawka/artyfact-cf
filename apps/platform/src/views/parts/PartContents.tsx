import type { PartRecord } from "../../../shared/api";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { CommandBlock } from "@/components/CommandBlock/CommandBlock";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { Section } from "@/components/Section/Section";
import { relTime, useNow } from "@/model/time";
import styles from "./parts.module.css";

/** `sha256:25c068…dbef`: enough to compare by eye; the full digest is the tooltip and the Copy value. */
export const shortDigest = (digest: string) => (digest.length > 24 ? `${digest.slice(0, 13)}…${digest.slice(-4)}` : digest);

const entries = (value: unknown): [string, unknown][] => (value && typeof value === "object" ? Object.entries(value) : []);
const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** The Part's identity line: `id@version` with Copy, then version, publication time and digest. No eyebrow. */
export function PartMeta({ part }: { part: PartRecord }) {
  const now = useNow(60_000);
  const pkg = part.package;
  const pin = `${pkg.id}@${pkg.version}`;
  return (
    <div className={styles.meta}>
      <div className={styles.pin}><code>{pin}</code><CopyButton value={pin} label="Copy pin" /></div>
      <div className={styles.pin}>
        <MetaLine items={[
          { label: "published", value: relTime(part.publishedAt, now), title: part.publishedAt || undefined },
          { label: "digest", value: shortDigest(part.digest), code: true, title: part.digest },
        ]} />
        <CopyButton value={part.digest} label="Copy digest" />
      </div>
    </div>
  );
}

/** Dependencies and inputs, payload, saved commands: each section states its own absence. Shared by Shared and Private Parts. */
export function PartContents({ part, headingLevel = 2 }: { part: PartRecord; headingLevel?: 2 | 3 }) {
  const pkg = part.package;
  const deps = pkg.recipe?.contributions.map((c) => c.part) ?? [];
  const files = entries(pkg.payload.files);
  const nodes = entries(pkg.payload.model);
  return <>
    <Section title="Dependencies and inputs" headingLevel={headingLevel}>
      {deps.length === 0 && pkg.inputs.length === 0 && !pkg.recipe ? <p className={styles.quiet}>No dependencies or inputs.</p> : <>
        {deps.length > 0 && <ul className={styles.list} aria-label="Dependencies">{deps.map((d, i) => <li key={i}><code>{d.id}@{d.version}</code></li>)}</ul>}
        {pkg.inputs.length > 0 && <ul className={styles.list} aria-label="Inputs">{pkg.inputs.map((input) => <li key={input.name}><code>{input.name}</code>{" "}<span className={styles.quiet}>{input.required ? "required" : "optional"}{input.default !== undefined ? `, default ${String(input.default)}` : ""}{input.description ? `. ${input.description}` : ""}</span></li>)}</ul>}
      </>}
    </Section>
    <Section title="Payload" headingLevel={headingLevel} description={`${files.length} ${files.length === 1 ? "file" : "files"}, ${nodes.length === 0 ? "no Genome nodes" : `${nodes.length} Genome ${nodes.length === 1 ? "node" : "nodes"}`}`}>
      {files.length > 0 && <ul className={styles.files} aria-label="Payload files">
        {files.map(([path, content]) => <li key={path}><details><summary><code>{path}</code><span className={styles.quiet}>{typeof content === "string" ? `${content.length} characters` : ""}</span></summary><pre tabIndex={0} className={styles.code}>{text(content)}</pre></details></li>)}
      </ul>}
      {nodes.length > 0 && <ul className={styles.list} aria-label="Genome nodes">{nodes.map(([id]) => <li key={id}><code>{id}</code></li>)}</ul>}
      <details className={styles.raw}><summary>View raw JSON</summary><pre tabIndex={0} className={styles.code}>{JSON.stringify(pkg.payload, null, 2)}</pre></details>
    </Section>
    <Section title="Saved commands" headingLevel={headingLevel}>
      {pkg.commands.length === 0 ? <p className={styles.quiet}>No saved commands.</p> : <>
        {pkg.commands.map((c) => <CommandBlock key={c.id} commands={[c.run]}><p className={styles.quiet}>{c.purpose}{c.cwd ? ` (in ${c.cwd})` : ""}</p></CommandBlock>)}
        <p className={styles.quiet}>Commands are saved instructions. This page does not run them.</p>
      </>}
    </Section>
  </>;
}
