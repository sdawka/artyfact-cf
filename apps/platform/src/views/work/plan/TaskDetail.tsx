import { Button } from "@/components/ui";
import { Link } from "react-router";
import { useKeepParams } from "@/model/useSelection";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { Facts } from "@/components/Facts/Facts";
import { KindGlyphs, NodeChip } from "@/components/NodeChip/NodeChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { groupByLayer, layerFromModel } from "@/model/layers";
import { useModel } from "@/model/useModel";
import { CopyText } from "../CopyText";
import { relTime, verdictStatus } from "../lib";
import { taskCommand, titleOf, waveOf, whyWave } from "./lib";
import styles from "./plan.module.css";

interface Props {
  id: string;
  task: Task;
  plan: RealizationPlan;
  now: number;
  /** Why writes are refused (fixture, no admin token), or null. */
  writeReason: string | null;
  /** The command was hidden in its wave; it stays hidden here. */
  commandHidden: boolean;
  onOpenTask(id: string): void;
}

const List = ({ items, empty }: { items: readonly string[]; empty: string }) =>
  items.length ? <ul className={styles.paths}>{[...new Set(items)].map((x) => <li key={x}>{x}</li>)}</ul> : <p className={styles.quiet}>{empty}</p>;

/**
 * The expanded task row (`?task=`): why it is in its wave, its command, steps and checks, then its scope (write and read
 * nodes, footprint), dependencies, attempts and the review link. Two columns from 1100px.
 */
export function TaskDetail({ id, task: t, plan, now, commandHidden, onOpenTask }: Props) {
  const m = useModel();
  const href = useKeepParams();
  const n = waveOf(plan, t.id);
  const fp = t.footprint;
  const command = taskCommand(plan, t, now);

  return (
    <div id={id} className={styles.taskDetail} data-testid="task-detail">
      <div className={styles.taskCol}>
        <p className={styles.quiet}><code>{t.id}</code> binding <code>{t.artifactId}</code></p>
        <section>
          <h4>Why wave {n ?? "?"}</h4>
          <p>{whyWave(plan, t.id)}</p>
        </section>
        <section>
          <h4>Command</h4>
          {!command.verb ? (
            <p className={styles.quiet}>{command.reason}</p>
          ) : commandHidden ? (
            <p className={styles.quiet}>Command hidden.</p>
          ) : (
            <>
              <pre className={styles.commandLine}><code>{command.line}</code></pre>
              <CopyText value={command.line} label="Copy" name={`Copy the command for ${t.title}`} variant="ghost" size="compact" />
            </>
          )}
        </section>
        <section>
          <h4>Steps</h4>
          {t.steps.length ? <ol className={styles.steps}>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p className={styles.quiet}>None.</p>}
        </section>
        <section>
          <h4>Checks</h4>
          {t.checks.length ? (
            <KindGlyphs hidden>
              {groupByLayer(t.checks, (c) => layerFromModel(m, c)).map((g) => (
                <div key={g.layer} role="group" aria-label={g.label} data-layer={g.layer}>
                  <h5>{g.label} · {g.says}</h5>
                  <ul className={styles.checks}>
                    {g.items.map((c) => <li key={c}><NodeChip id={c} size="sm" glyph={false} /><StatusText {...verdictStatus(m.verdictOf(c))} /></li>)}
                  </ul>
                </div>
              ))}
            </KindGlyphs>
          ) : <p className={styles.quiet}>None.</p>}
        </section>
      </div>
      <div className={styles.taskCol}>
        <section aria-label="Model" data-testid="task-model">
          <h4>Model</h4>
          {t.model ? (
            <>
              <Facts items={[
                { term: "Pinned Genome", value: <code title={t.model.genomeCommit}>{t.model.genomeCommit.slice(0, 7)}</code> },
                { term: "In the fork", value: <><code>{t.model.prefix}/</code> at <code title={t.model.commit}>{t.model.commit.slice(0, 7)}</code></> },
              ]} />
              <p className={styles.quiet}>Read-only unless the model cannot be realized as written; then the agent edits <code>{t.model.prefix}/</code> and says why in a checkpoint.</p>
            </>
          ) : (
            <p className={styles.quiet}>The pinned Genome <code title={plan.genome.commit}>{plan.genome.commit.slice(0, 7)}</code> is committed under <code>system/</code> at the first claim; read-only unless the model cannot be realized as written.</p>
          )}
        </section>
        <section>
          <h4>Write nodes</h4>
          <span className={styles.chips}>{t.writeNodes.map((nid) => <NodeChip key={nid} id={nid} size="sm" />)}</span>
        </section>
        <section>
          <h4>Read nodes</h4>
          {t.readNodes.length ? <span className={styles.chips}>{t.readNodes.map((nid) => <NodeChip key={nid} id={nid} size="sm" />)}</span> : <p className={styles.quiet}>None.</p>}
        </section>
        <section>
          <h4>Footprint</h4>
          <p className={styles.quiet}>
            Computed from the nodes' files bindings in <code>{fp.repo || t.artifactId}</code>.
            {fp.known ? "" : " Some scope is unknown, so this task runs alone."}
          </p>
          <h5>Write globs</h5>
          <List items={fp.globs} empty="None." />
          <h5>Files written</h5>
          <List items={fp.paths} empty="No file matches yet." />
          {fp.unmatched.length > 0 && <p className={styles.quiet}>Match nothing yet (files the task may create): {fp.unmatched.join(", ")}</p>}
          {(fp.readGlobs?.length ?? 0) + (fp.readPaths?.length ?? 0) > 0 && (
            <>
              <h5>Read scope</h5>
              <List items={[...(fp.readGlobs ?? []), ...(fp.readPaths ?? [])]} empty="None." />
            </>
          )}
        </section>
        <section>
          <h4>Depends on</h4>
          {t.dependsOn.length ? (
            <ul className={styles.chips}>
              {t.dependsOn.map((d) => <li key={d}><Button variant="ghost" size="compact" onClick={() => onOpenTask(d)}>{titleOf(plan, d)}</Button></li>)}
            </ul>
          ) : <p className={styles.quiet}>Nothing; it can start in its wave.</p>}
        </section>
      </div>
      <section className={styles.taskWide}>
        <h4>Attempts</h4>
        {t.attempts.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.attemptsTable}>
              <thead><tr><th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Generation</th><th scope="col">Realization</th><th scope="col">Lease</th></tr></thead>
              <tbody>
                {t.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.agentLabel}</td>
                    <td>{a.status}</td>
                    <td className="u-numeric">{a.generation}</td>
                    <td><code>{a.realizationId}</code></td>
                    <td title={a.leaseExpiresAt}>{a.status === "ended" ? "ended" : Date.parse(a.leaseExpiresAt) > now ? `until ${a.leaseExpiresAt}` : `lapsed ${relTime(a.leaseExpiresAt, now)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.quiet}>No attempt yet.</p>}
        {t.selectedCandidate && <p>Selected candidate <code>{t.selectedCandidate}</code></p>}
        {(t.status === "submitted" || t.selectedCandidate) && (
          <Button asChild variant="secondary"><Link to={href("review", { plan: plan.id, task: t.id, panel: null, evolution: null, realization: null })}>Review Task result</Link></Button>
        )}
      </section>
    </div>
  );
}
