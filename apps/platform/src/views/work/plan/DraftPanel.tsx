import { useId, useState } from "react";
import type { Evolution } from "../../../../shared/api";
import type { DraftRealizationPlanResponse, RealizationPlan } from "../../../../shared/lifecycle";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi } from "@/api/lifecycle";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useSystemRoute } from "@/model/useSelection";
import { canMerge, canRemove, canSplit, draftErrors, mergeTasks, removeTask, renameTask, splitTask, type DraftTask } from "./draft";
import { plural, planError, quote } from "./lib";
import workStyles from "../work.module.css";
import styles from "./plan.module.css";

/** Accepted Genome Evolutions the planner may implement; the server drops any already realized on its binding. */
const ACCEPTED = new Set<Evolution["state"]>(["genome-approved", "promoted"]);
const lines = (text: string) => text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

interface Props {
  evolutions: readonly Evolution[];
  /** Why writes are refused (fixture, no admin token), or null. */
  writeReason: string | null;
  onCreated(plan: RealizationPlan): void;
  onCancel(): void;
}

/**
 * Draft → edit → create. "Draft tasks" asks the planner for an editable draft (nothing is stored). The person renames,
 * merges, splits or removes tasks, then "Create plan" posts the edited list to create, which pins the Genome and
 * recomputes footprints and waves.
 */
export function DraftPanel({ evolutions, writeReason, onCreated, onCancel }: Props) {
  const uid = useId();
  const { systemId } = useSystemRoute();
  const { token } = useAdminToken();
  const [picked, setPicked] = useState<string[]>([]);
  const [nodes, setNodes] = useState("");
  const [hint, setHint] = useState("");
  const [draft, setDraft] = useState<DraftRealizationPlanResponse | null>(null);
  const [title, setTitle] = useState("");
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accepted = evolutions.filter((e) => ACCEPTED.has(e.state));
  const edited = !!draft && JSON.stringify(tasks) !== JSON.stringify(draft.request.tasks);
  const scopeReason = picked.length || lines(nodes).length ? null : "Pick an Evolution or name Genome nodes to draft from.";
  const draftReason = writeReason ?? scopeReason;
  const errors = draft ? draftErrors(tasks) : [];
  const createReason = writeReason ?? (!title.trim() ? "Give the plan a title." : errors.length ? "Fix the problems listed above first." : null);
  const mergeReason = canMerge(tasks, selected);

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(planError(what, e));
    } finally {
      setBusy(false);
    }
  };
  const runDraft = () =>
    act("Drafting tasks", async () => {
      const res = await lifecycleApi.draft(systemId, { evolutionIds: picked, nodes: lines(nodes), ...(hint.trim() && { hint: hint.trim() }) }, token);
      setDraft(res);
      setTitle(res.request.title);
      setTasks(res.request.tasks);
      setSelected([]);
    });
  const create = () =>
    act("Creating the plan", async () => {
      if (!draft || createReason) return;
      onCreated(await lifecycleApi.createPlan(systemId, { ...draft.request, title: title.trim(), tasks }, token));
    });

  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
      <div className={workStyles.rhead}>
        <h3 id={`${uid}-h`}>Plan implementation</h3>
        <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={onCancel}>Close</button>
      </div>
      <form className={workStyles.form} onSubmit={(e) => { e.preventDefault(); if (!draftReason) void runDraft(); }}>
        <fieldset className={workStyles.fieldset}>
          <legend>Accepted Genome Evolutions</legend>
          {accepted.length ? accepted.map((e) => (
            <label key={e.id} className={workStyles.check}>
              <input type="checkbox" checked={picked.includes(e.id)} onChange={(ev) => setPicked((xs) => (ev.target.checked ? [...xs, e.id] : xs.filter((x) => x !== e.id)))} />
              {e.title} <span className={workStyles.muted}>({e.id})</span>
            </label>
          )) : <p className={workStyles.muted}>No accepted Genome Evolution. Name nodes below instead.</p>}
        </fieldset>
        <div className={workStyles.field}>
          <label htmlFor={`${uid}-n`}>Genome nodes to implement</label>
          <textarea id={`${uid}-n`} rows={2} value={nodes} onChange={(e) => setNodes(e.target.value)} placeholder="One node ID per line" />
        </div>
        <div className={workStyles.field}>
          <label htmlFor={`${uid}-hint`}>Hint for the planner</label>
          <textarea id={`${uid}-hint`} rows={2} value={hint} onChange={(e) => setHint(e.target.value)} />
        </div>
        <div className={workStyles.actions}>
          <button type="submit" className={`u-brackets ${draft ? workStyles.btn : workStyles.primary}`} disabled={!!draftReason || busy} aria-describedby={draftReason ? `${uid}-dr` : undefined}>
            {busy && !draft ? "Drafting…" : draft ? "Draft again" : "Draft tasks"}
          </button>
          {draftReason && <span id={`${uid}-dr`} className={workStyles.reason}>{draftReason}</span>}
        </div>
      </form>

      {draft && (
        <section aria-labelledby={`${uid}-d`} className={styles.draftTask}>
          <h4 id={`${uid}-d`}>Draft · {plural(tasks.length, "task")}</h4>
          <p className={workStyles.muted}>
            Drafted by {draft.provenance.planner.provider}/{draft.provenance.planner.model} from Genome <code>{draft.provenance.genomeCommit.slice(0, 7)}</code>
            {draft.provenance.fallback ? "; the deterministic partition was used" : ""}. Nothing is stored until you create the plan.
          </p>
          {draft.problems.length > 0 && (
            <ul className={workStyles.reasons} aria-label="Draft problems">
              {draft.problems.map((p, i) => <li key={i} data-severity={p.severity}>{p.severity}: {p.taskId ? `${p.taskId}: ` : ""}{p.message}</li>)}
            </ul>
          )}
          <p data-testid="draft-waves">
            {edited
              ? "Edited: waves are recomputed when the plan is created."
              : `As drafted: ${draft.analysis.waves.map((w, i) => `wave ${i + 1} (${w.join(", ")})`).join("; ") || "no waves"}.`}
          </p>
          <div className={styles.toolbar} role="toolbar" aria-label="Draft actions">
            <button type="button" className={`u-brackets ${workStyles.btn}`} disabled={!!mergeReason} aria-describedby={mergeReason ? `${uid}-mg` : undefined} onClick={() => { setTasks(mergeTasks(tasks, selected)); setSelected([]); }}>
              Merge selected{selected.length ? ` (${selected.length})` : ""}
            </button>
            {mergeReason && <span id={`${uid}-mg`} className={workStyles.reason}>{mergeReason}</span>}
            {edited && <button type="button" className={`u-brackets ${workStyles.btn}`} onClick={() => { setTasks(draft.request.tasks); setSelected([]); }}>Undo edits</button>}
          </div>
          <ol className={workStyles.plain}>
            {tasks.map((t) => (
              <li key={t.id}>
                <DraftTaskEditor
                  task={t}
                  selected={selected.includes(t.id)}
                  onSelect={(on) => setSelected((xs) => (on ? [...xs, t.id] : xs.filter((x) => x !== t.id)))}
                  onRename={(v) => setTasks((ts) => renameTask(ts, t.id, v))}
                  onSplit={(moving, splitTitle) => setTasks((ts) => splitTask(ts, t.id, moving, splitTitle))}
                  removeReason={canRemove(tasks)}
                  onRemove={() => { setTasks((ts) => removeTask(ts, t.id)); setSelected((xs) => xs.filter((x) => x !== t.id)); }}
                />
              </li>
            ))}
          </ol>
          {errors.length > 0 && <ul className={workStyles.reasons} aria-label="Problems to fix">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className={workStyles.field}>
            <label htmlFor={`${uid}-t`}>Plan title</label>
            <input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          </div>
          <div className={workStyles.actions}>
            <button type="button" className={`u-brackets ${workStyles.primary}`} disabled={!!createReason || busy} aria-describedby={createReason ? `${uid}-cr` : undefined} onClick={() => void create()}>
              {busy ? "Working…" : "Create plan"}
            </button>
            {createReason && <span id={`${uid}-cr`} className={workStyles.reason}>{createReason}</span>}
          </div>
        </section>
      )}
      {error && <p role="alert" className={workStyles.error}>{error}</p>}
    </section>
  );
}

interface EditorProps {
  task: DraftTask;
  selected: boolean;
  onSelect(on: boolean): void;
  onRename(title: string): void;
  onSplit(nodes: string[], title: string): void;
  removeReason: string | null;
  onRemove(): void;
}

/** One draft task: select for merge, rename, split by write nodes, remove. */
function DraftTaskEditor({ task: t, selected, onSelect, onRename, onSplit, removeReason, onRemove }: EditorProps) {
  const uid = useId();
  const [moving, setMoving] = useState<string[]>([]);
  const [splitTitle, setSplitTitle] = useState("");
  const splitReason = canSplit(t, moving);
  return (
    <fieldset className={`${workStyles.fieldset} ${styles.draftTask}`} data-testid={`draft-${t.id}`}>
      <legend>{t.title || t.id}</legend>
      <label className={workStyles.check}>
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        Select {quote(t.title || t.id)} to merge
      </label>
      <div className={workStyles.field}>
        <label htmlFor={`${uid}-t`}>Title of {t.id}</label>
        <input id={`${uid}-t`} value={t.title} onChange={(e) => onRename(e.target.value)} autoComplete="off" />
      </div>
      <p className={workStyles.muted}>
        <code>{t.id}</code> · binding <code>{t.artifactId}</code> · {plural(t.steps.length, "step")} · {plural(t.checks.length, "check")}
        {t.dependsOn.length > 0 && <> · depends on {t.dependsOn.join(", ")}</>}
      </p>
      <span className={workStyles.chips} aria-label={`Writes of ${t.id}`}>{t.writeNodes.map((id) => <NodeChip key={id} id={id} size="sm" interactive={false} />)}</span>
      {t.readNodes.length > 0 && <p className={workStyles.muted}>Reads {t.readNodes.join(", ")}</p>}
      {t.writeNodes.length > 1 && (
        <fieldset className={workStyles.fieldset}>
          <legend>Split {t.id}</legend>
          {t.writeNodes.map((id) => (
            <label key={id} className={workStyles.check}>
              <input type="checkbox" checked={moving.includes(id)} onChange={(e) => setMoving((xs) => (e.target.checked ? [...xs, id] : xs.filter((x) => x !== id)))} />
              Move {id}
            </label>
          ))}
          <div className={workStyles.field}>
            <label htmlFor={`${uid}-s`}>New task title</label>
            <input id={`${uid}-s`} value={splitTitle} onChange={(e) => setSplitTitle(e.target.value)} placeholder={`${t.title} (split)`} autoComplete="off" />
          </div>
          <div className={workStyles.actions}>
            <button type="button" className={`u-brackets ${workStyles.btn}`} disabled={!!splitReason} aria-describedby={splitReason ? `${uid}-sr` : undefined} onClick={() => { onSplit(moving, splitTitle); setMoving([]); setSplitTitle(""); }}>
              Split
            </button>
            {splitReason && <span id={`${uid}-sr`} className={workStyles.reason}>{splitReason}</span>}
          </div>
        </fieldset>
      )}
      <div className={workStyles.actions}>
        <button type="button" className={`u-brackets ${workStyles.btn}`} disabled={!!removeReason} aria-describedby={removeReason ? `${uid}-rr` : undefined} onClick={onRemove} aria-label={`Remove ${t.title || t.id}`}>Remove</button>
        {removeReason && <span id={`${uid}-rr`} className={workStyles.reason}>{removeReason}</span>}
      </div>
    </fieldset>
  );
}
