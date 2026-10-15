import { useState } from "react";
import { Link } from "react-router";
import { useDeployments, useReadiness, useRevisions } from "@/api/queries";
import { Facts } from "@/components/Facts/Facts";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { Button } from "@/components/ui";
import { Unknown } from "@/components/Unknown/Unknown";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { TemplateUpgradePanel, useAppTemplate } from "./AppTemplateCard";
import { headCommit, shortRev } from "./states";
import styles from "./Overview.module.css";

const isZeros = (s: string) => /^0+$/.test(s);

/** The live production deployment (URL and short commit), a failed one in the danger tone, else "not deployed". */
function DeploymentValue() {
  const href = useKeepParams();
  const { data } = useDeployments();
  const production = (d: { kind: string }) => d.kind === "production";
  const live = data?.production?.status === "live" ? data.production : data?.history.find((d) => production(d) && d.status === "live");
  const failed = !live && data?.history.find((d) => production(d) && d.status === "failed");
  return (
    <span className={styles.factValue}>
      {live ? (
        <>
          {live.url && <a href={live.url} target="_blank" rel="noopener noreferrer">{live.url}</a>}{" "}
          <code>{live.commit.slice(0, 7)}</code>{live.systemCommit ? ` (${live.systemCommit})` : ""}
        </>
      ) : failed ? (
        <StatusText status="failed" label="last deploy failed" tone="fail" />
      ) : (
        "not deployed"
      )}
      <Link to={href("phenome")}>Deployments</Link>
    </span>
  );
}

/** Reference facts as one key/value strip: phase, head, Genome commit, deployment, app template; provenance on demand. */
export function FactsStrip() {
  const m = useModel();
  const { data } = useReadiness();
  const tpl = useAppTemplate();
  const { data: revisions } = useRevisions();
  const [upgrading, setUpgrading] = useState(false);
  const report = (data ?? m.bundle.readiness) as typeof m.bundle.readiness & {
    snapshotHash?: string;
    packs?: { id: string; version: string; hash?: string }[];
  };
  if (upgrading && !tpl.hidden && tpl.plan && !tpl.plan.upToDate) {
    return <TemplateUpgradePanel plan={tpl.plan} onBack={() => setUpgrading(false)} />;
  }
  const system = m.index.model.system;
  const head = headCommit(system.head, revisions);
  const commit = m.bundle.genomeCommit;
  const packs =
    report.packs?.map((p) => `${p.id}@${p.version}`) ??
    (m.index.model.kits?.rulePacks ?? []).map((p) => `${p.id}@${p.version}`);
  return (
    <Section title="Facts">
      <Facts>
        <dt>Phase</dt><dd>{system.phase ?? <Unknown />}</dd>
        <dt>Head</dt><dd>{head ? <code className={styles.nowrap} title={head}>{shortRev(head)}</code> : <Unknown />}</dd>
        <dt>Genome commit</dt><dd>{commit && !isZeros(commit) ? <code>{commit.slice(0, 7)}</code> : <Unknown />}</dd>
        <dt>Deployment</dt><dd><DeploymentValue /></dd>
        {!tpl.hidden && (
          <>
            <dt>App template</dt>
            <dd className={styles.templateRow}>
              <span>{tpl.summary}</span>
              <Button size="compact" aria-expanded={upgrading} reason={tpl.reason ?? (tpl.plan ? undefined : "Checking the app template…")} onClick={() => setUpgrading(true)}>
                Review upgrade
              </Button>
            </dd>
          </>
        )}
      </Facts>
      <details className={styles.details}>
        <summary>Provenance</summary>
        <Facts>
          <dt>Rule packs</dt>
          <dd>{packs.length ? <ul className={styles.codeList}>{packs.map((p) => <li key={p}><code>{p}</code></li>)}</ul> : <Unknown />}</dd>
          <dt>Snapshot hash</dt>
          <dd>{report.snapshotHash ? <code>{report.snapshotHash.slice(0, 12)}</code> : <Unknown />}</dd>
        </Facts>
      </details>
    </Section>
  );
}
