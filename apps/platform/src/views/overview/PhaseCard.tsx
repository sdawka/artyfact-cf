import { useReadiness } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import styles from "./Overview.module.css";

const isZeros = (s: string) => /^0+$/.test(s);

/** System phase, head, Genome commit and the rule packs behind the readiness numbers. */
export function PhaseCard() {
  const m = useModel();
  const { data } = useReadiness();
  const report = (data ?? m.bundle.readiness) as typeof m.bundle.readiness & {
    snapshotHash?: string;
    packs?: { id: string; version: string; hash?: string }[];
  };
  const system = m.index.model.system;
  const commit = m.bundle.genomeCommit;
  const packs =
    report.packs?.map((p) => `${p.id}@${p.version}`) ??
    (m.index.model.kits?.rulePacks ?? []).map((p) => `${p.id}@${p.version}`);
  return (
    <section className={styles.card} aria-labelledby="phase-title">
      <h2 id="phase-title" className={styles.cardTitle}>Phase</h2>
      <dl className={styles.facts}>
        <dt>System</dt><dd><NodeChip id={system.id} size="sm" /></dd>
        <dt>Phase</dt><dd>{system.phase}</dd>
        <dt>Head</dt><dd>{system.head ? <code>{system.head.slice(0, 7)}</code> : "unknown"}</dd>
        <dt>Revision</dt><dd><code>{m.bundle.revision.length > 12 ? m.bundle.revision.slice(0, 7) : m.bundle.revision}</code></dd>
        <dt>Genome commit</dt><dd>{commit && !isZeros(commit) ? <code>{commit.slice(0, 7)}</code> : "unknown"}</dd>
        <dt>Rule packs</dt>
        <dd>{packs.length ? <ul className={styles.codeList}>{packs.map((p) => <li key={p}><code>{p}</code></li>)}</ul> : "unknown"}</dd>
        <dt>Snapshot hash</dt>
        <dd>{report.snapshotHash ? <code>{report.snapshotHash.slice(0, 12)}</code> : "unknown"}</dd>
      </dl>
    </section>
  );
}
