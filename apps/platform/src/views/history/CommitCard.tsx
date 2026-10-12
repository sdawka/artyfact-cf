import type { SystemCommit } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import styles from "./history.module.css";

/** The backend may add phase/deploy details to a commit; none of it is in the model schema yet. */
export type CommitView = Omit<SystemCommit, "decision"> & {
  decision: SystemCommit["decision"] & { acknowledged?: unknown[] };
  phase?: string;
  deploy?: { url?: string; status?: string };
};

/** Criterion ids from `decision.acknowledged`: plain ids or gate items. */
const acknowledged = (c: CommitView): string[] =>
  (c.decision.acknowledged ?? []).flatMap((x) =>
    typeof x === "string" ? [x] : x && typeof (x as { criterion?: unknown }).criterion === "string" ? [(x as { criterion: string }).criterion] : [],
  );

const short = (s: string | null | undefined) => (s ? s.slice(0, 10) : "none");

/** One System commit: manifest, parent, Evolutions, per-artifact repo commits, decision and phase. */
export function CommitCard({ commit: c, highlighted }: { commit: CommitView; highlighted?: boolean }) {
  return (
    <article
      id={`commit-${c.id}`}
      className={styles.card}
      aria-labelledby={`commit-title-${c.id}`}
      {...(highlighted && { "aria-current": "true" as const })}
      data-highlighted={highlighted || undefined}
    >
      <header className={styles.head}>
        <h3 id={`commit-title-${c.id}`} className={styles.title}>
          System commit <code>{short(c.id)}</code>
        </h3>
        <CopyButton value={c.id} label="Copy commit id" />
      </header>
      <dl className={styles.facts}>
        <dt>Manifest</dt>
        <dd><code>{c.id}</code></dd>
        <dt>Parent</dt>
        <dd>{c.parent ? <code>{short(c.parent)}</code> : "none (first commit)"}</dd>
        <dt>Genome</dt>
        <dd><code>{short(c.genomeCommit)}</code></dd>
        <dt>Phase</dt>
        <dd>{c.phase ?? "unknown"}{c.deploy?.status ? `, deploy ${c.deploy.status}` : ""}</dd>
        <dt>Evolutions</dt>
        <dd>
          {c.evolutions.length ? (
            <ul className={styles.chips}>{c.evolutions.map((id) => <li key={id}><NodeChip id={id} size="sm" /></li>)}</ul>
          ) : "none"}
        </dd>
        <dt>Candidates</dt>
        <dd>{c.candidates.length ? c.candidates.map((x) => <code key={x} className={styles.inline}>{x}</code>) : "none"}</dd>
        {c.rejected.length > 0 && (
          <>
            <dt>Rejected</dt>
            <dd>{c.rejected.map((x) => <code key={x} className={styles.inline}>{x}</code>)}</dd>
          </>
        )}
        <dt>Repo commits</dt>
        <dd>
          {c.manifest.length ? (
            <ul className={styles.plain}>
              {c.manifest.map((b) => (
                <li key={b.artifact}>
                  <NodeChip id={b.artifact} size="sm" /> <code>{b.repo ?? "unknown repo"}@{short(b.commit)}</code>
                </li>
              ))}
            </ul>
          ) : "none"}
        </dd>
        <dt>Evidence</dt>
        <dd>{c.evidence.length} evaluation{c.evidence.length === 1 ? "" : "s"}</dd>
      </dl>
      <blockquote className={styles.decision}>
        <p>{c.decision.rationale || "No rationale recorded."}</p>
        {acknowledged(c).length > 0 && (
          <div className={styles.ack}>
            <span className={styles.muted}>Advisories acknowledged</span>
            <ul className={styles.chips}>
              {[...new Set(acknowledged(c))].map((id) => <li key={id}><NodeChip id={id} size="sm" /></li>)}
            </ul>
          </div>
        )}
        <footer>
          {c.decision.by} · <time dateTime={c.decision.at}>{c.decision.at}</time> · policy {c.decision.policy}
        </footer>
      </blockquote>
    </article>
  );
}
