import { Button } from "@/components/ui";
import { useId } from "react";
import { Link } from "react-router";
import { useKeepParams } from "@/model/useSelection";
import type { RealizationPlan, Task } from "../../../../shared/lifecycle";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VerdictBadge } from "@/components/VerdictBadge/VerdictBadge";
import { useModel } from "@/model/useModel";
import { displayStatus, taskCommand, titleOf, waveOf, whyWave } from "./lib";
import { TaskStatus } from "./TaskStatus";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

interface Props {
  task: Task;
  plan: RealizationPlan;
  now: number;
  /** Why writes are refused (fixture, no admin token), or null. */
  writeReason: string | null;
  /** The command was hidden on the board; it stays hidden here. */
  commandHidden: boolean;
  error: string | null;
  onOpenTask(id: string): void;
  onClose(): void;
}

const List = ({ items, empty }: { items: readonly string[]; empty: string }) =>
  items.length ? <ul className={styles.paths}>{[...new Set(items)].map((x) => <li key={x}>{x}</li>)}</ul> : <p className={workStyles.muted}>{empty}</p>;

/** `?task=`: why the task is in its wave, its footprint, read and write nodes, steps, checks, attempts, and the review link. */
export function TaskDetail({ task: t, plan, now, writeReason, commandHidden, error, onOpenTask, onClose }: Props) {
  const uid = useId();
  const m = useModel();
  const href = useKeepParams();
  const n = waveOf(plan, t.id);
  const fp = t.footprint;
  const command = taskCommand(plan, t, now);


  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`} data-testid="task-detail">
      <div className={workStyles.rhead}>
        <h4 id={`${uid}-h`}>{t.title}</h4>
        <TaskStatus status={displayStatus(t, plan)} />
        <Button type="button" variant="secondary" onClick={onClose}>Close task</Button>
      </div>
      <p className={workStyles.muted}><code>{t.id}</code> · binding <code>{t.artifactId}</code></p>

      <h5>Why wave {n ?? "?"}</h5>
      <p>{whyWave(plan, t.id)}</p>

      <h5>Command</h5>
      {!command.verb ? (
        <p className={workStyles.muted}>{command.reason}</p>
      ) : commandHidden ? (
        <p className={workStyles.muted}>Command hidden.</p>
      ) : (
        <>
          <code className={styles.commandLine}>{command.line}</code>
          <span className={workStyles.inlineRow}><CopyButton value={command.line} /></span>
          <p className={workStyles.muted}>Set ADMIN_TOKEN in this shell without exporting it; the claim passes it to that command only, and the agent line unsets it.</p>
        </>
      )}

      <h5>Write nodes</h5>
      <span className={workStyles.chips}>{t.writeNodes.map((id) => <NodeChip key={id} id={id} size="sm" />)}</span>
      <h5>Read nodes</h5>
      {t.readNodes.length ? <span className={workStyles.chips}>{t.readNodes.map((id) => <NodeChip key={id} id={id} size="sm" />)}</span> : <p className={workStyles.muted}>none</p>}

      <h5>Footprint</h5>
      <p className={workStyles.muted}>
        Computed from the nodes' files bindings in <code>{fp.repo || t.artifactId}</code>.
        {fp.known ? "" : " Some scope is unknown, so this task runs alone."}
      </p>
      <div className={workStyles.group}>
        <h6>Write globs</h6>
        <List items={fp.globs} empty="none" />
      </div>
      <div className={workStyles.group}>
        <h6>Files written</h6>
        <List items={fp.paths} empty="No file matches yet." />
        {fp.unmatched.length > 0 && <p className={workStyles.muted}>Match nothing yet (files the task may create): {fp.unmatched.join(", ")}</p>}
      </div>
      {(fp.readGlobs?.length ?? 0) + (fp.readPaths?.length ?? 0) > 0 && (
        <div className={workStyles.group}>
          <h6>Read scope</h6>
          <List items={[...(fp.readGlobs ?? []), ...(fp.readPaths ?? [])]} empty="none" />
        </div>
      )}

      <h5>Steps</h5>
      {t.steps.length ? <ol>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p className={workStyles.muted}>none</p>}

      <h5>Checks</h5>
      {t.checks.length ? (
        <ul className={workStyles.plain}>
          {t.checks.map((c) => <li key={c} className={workStyles.inlineRow}><NodeChip id={c} size="sm" glyph={false} /><VerdictBadge verdict={m.verdictOf(c)} /></li>)}
        </ul>
      ) : <p className={workStyles.muted}>none</p>}

      <h5>Depends on</h5>
      {t.dependsOn.length ? (
        <ul className={workStyles.chips}>
          {t.dependsOn.map((d) => <li key={d}><Button type="button" variant="ghost" size="compact" onClick={() => onOpenTask(d)}>{titleOf(plan, d)}</Button></li>)}
        </ul>
      ) : <p className={workStyles.muted}>Nothing; it can start in its wave.</p>}

      <h5>Attempts</h5>
      {t.attempts.length ? (
        <ol>
          {t.attempts.map((a) => (
            <li key={a.id}>
              {a.agentLabel} · {a.status} · generation {a.generation} · realization <code>{a.realizationId}</code>
              {a.status !== "ended" && <> · lease until {a.leaseExpiresAt}</>}
            </li>
          ))}
        </ol>
      ) : <p className={workStyles.muted}>No attempt yet.</p>}
      {t.selectedCandidate && <p>Selected candidate <code>{t.selectedCandidate}</code></p>}

      {(t.status === "submitted" || t.selectedCandidate) && <Button asChild variant="secondary"><Link to={href("review", {plan:plan.id, task:t.id, panel:null, evolution:null, realization:null})}>Review Task result</Link></Button>}
      {error && <p role="alert" className={workStyles.error}>{error}</p>}
    </section>
  );
}
