import type { ReactNode } from "react";
import type { SystemCommit, SystemCompare } from "../../../shared/api";
import { shortSha } from "@/model/time";
import styles from "./compare.module.css";

const sha = (s: string | null | undefined) => (s ? <code title={s}>{shortSha(s)}</code> : "unknown");

function Row({ label, left, right, changed }: { label: ReactNode; left: ReactNode; right: ReactNode; changed: boolean }) {
  return (
    <tr data-changed={changed || undefined}>
      <th scope="row">{label}</th>
      <td>{left}</td>
      <td>{right}</td>
      <td>{changed ? "changed" : "same"}</td>
    </tr>
  );
}

const versions = (c: SystemCommit | null, kind: "templateVersions" | "hookVersions", key: string) => c?.composition?.[kind]?.[key] ?? "none";
const platform = (c: SystemCommit | null) => {
  const p = c?.composition?.platform;
  return p ? <code>{p.repo}@{shortSha(p.commit)}</code> : "unknown";
};

/** The two System commits side by side: Genome, manifest, platform, per-artifact commits and changed versions. */
export function SystemLevel({ cmp }: { cmp: SystemCompare }) {
  const { from, to } = cmp;
  const artifacts = [...new Set([...(from?.manifest ?? []), ...to.manifest].map((b) => b.artifact))].sort();
  const commitOf = (c: SystemCommit | null, artifact: string) => c?.manifest.find((b) => b.artifact === artifact);
  return (
    <table className={styles.table}>
      <caption className="sr-only">System commits compared</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">From</th>
          <th scope="col">To</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        <Row label="System commit" left={from ? <code>{from.id}</code> : "none"} right={<code>{to.id}</code>} changed={from?.id !== to.id} />
        <Row label="Genome commit" left={sha(cmp.genome.from)} right={sha(cmp.genome.to)} changed={cmp.genome.from !== cmp.genome.to} />
        <Row
          label="Manifest hash"
          left={from?.manifestHash ? <code title={from.manifestHash}>{from.manifestHash.slice(0, 12)}</code> : "unknown"}
          right={to.manifestHash ? <code title={to.manifestHash}>{to.manifestHash.slice(0, 12)}</code> : "unknown"}
          changed={(from?.manifestHash ?? null) !== (to.manifestHash ?? null)}
        />
        <Row label="Platform" left={platform(from)} right={platform(to)} changed={cmp.manifest.platformChanged} />
        {artifacts.map((a) => {
          const l = commitOf(from, a);
          const r = commitOf(to, a);
          return (
            <Row
              key={a}
              label={<>Artifact <code>{a}</code></>}
              left={l ? <>{l.repo ?? "unknown repo"} {sha(l.commit)}</> : "none"}
              right={r ? <>{r.repo ?? "unknown repo"} {sha(r.commit)}</> : "none"}
              changed={l?.commit !== r?.commit}
            />
          );
        })}
        {cmp.app && (
          <Row label="App files" left={sha(cmp.app.from?.commit)} right={sha(cmp.app.to.commit)}
            changed={(cmp.app.from?.commit ?? null) !== cmp.app.to.commit} />
        )}
        {cmp.manifest.templateVersions.map((k) => (
          <Row key={`t-${k}`} label={<>Template <code>{k}</code></>} left={versions(from, "templateVersions", k)} right={versions(to, "templateVersions", k)} changed />
        ))}
        {cmp.manifest.hookVersions.map((k) => (
          <Row key={`h-${k}`} label={<>Hook <code>{k}</code></>} left={versions(from, "hookVersions", k)} right={versions(to, "hookVersions", k)} changed />
        ))}
        {!cmp.manifest.templateVersions.length && !cmp.manifest.hookVersions.length && (
          <Row label="Template and hook versions" left="—" right="—" changed={false} />
        )}
      </tbody>
    </table>
  );
}
