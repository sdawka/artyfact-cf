import { Select, Button, Checkbox, Input, Textarea } from "@/components/ui";
import { useId, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { EditorCommitRequest, FileScope, StartWorkRequest } from "../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { ApiRequestError, FixtureModeError, getFile } from "@/api/client";
import { ManualCommitError, useEvolutions, useManualCommit, useTree, qk, type ManualCommitProgress } from "@/api/queries";
import { Panel } from "@/components/Panel/Panel";
import { emitFx } from "@/effects/fx";
import { useKeepParams, useSystemRoute } from "@/model/useSelection";
import { rememberWhy } from "./why";
import styles from "./code.module.css";

const NEW = "__new";
const STARTABLE = new Set(["actionable", "realizing"]);
const NAME_KEY = "artyfact.editor.name";

export interface CommitSheetProps {
  repo: FileScope;
  fixture: boolean;
  changes: EditorCommitRequest["changes"];
  onClose(): void;
  /** Called after a successful commit (the draft is cleared). */
  onCommitted(): void;
  /** Ids a failed attempt already created (owned by the page so closing the sheet keeps them; never stored). */
  resume: ManualCommitProgress | null;
  onResume(progress: ManualCommitProgress | null): void;
}

/** Plain wording for auth refusals; anything else keeps the server's message. */
export function commitError(err: unknown): string {
  if (err instanceof ManualCommitError) return commitError(err.cause);
  if (err instanceof FixtureModeError) return "Commit needs the platform API.";
  if (err instanceof ApiRequestError && err.status === 401) return "Commit needs the admin token (401). Set the admin token in the header and try again.";
  if (err instanceof ApiRequestError && err.status === 403) return "The admin token was refused (403). Check it in the header and try again.";
  if (err instanceof ApiRequestError && err.status === 409) return `The fork moved since the draft was read (409): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function loadName(): string {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Commit the draft as a Panel that replaces the file region: message, why, target Evolution (or a new one), name; then a candidate on Work. */
export function CommitSheet({ repo, fixture, changes, onClose, onCommitted, resume, onResume }: CommitSheetProps) {
  const uid = useId();
  const navigate = useNavigate();
  const href = useKeepParams();
  const { systemId, rev } = useSystemRoute();
  const qc = useQueryClient();
  const tree = useTree({ repo });
  const formRef = useRef<HTMLFormElement>(null);
  const evolutions = useEvolutions();
  const commit = useManualCommit();
  const [message, setMessage] = useState("");
  const [why, setWhy] = useState("");
  const [leaveToAgent, setLeaveToAgent] = useState(false);
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [name, setName] = useState(loadName);
  // The admin token is the header's: this form has no field for it.
  const { token: adminToken } = useAdminToken();

  const open = (evolutions.data?.evolutions ?? []).filter((e) => STARTABLE.has(e.state));
  const resuming = !!resume?.realizationId && !!resume.secret;

  const reasons: string[] = [];
  if (repo === "app") reasons.push("App implementation uses a Realization Task in your local harness.");
  if (fixture) reasons.push("Commit needs the platform API.");
  if (!changes.length) reasons.push("There are no pending changes.");
  if (!message.trim()) reasons.push("Write a commit message.");
  if (!leaveToAgent && !why.trim()) reasons.push("Say why, or leave the rationale to the agent.");
  if (!name.trim()) reasons.push("Enter your name.");
  if (!resume?.evolutionId) {
    if (!target) reasons.push("Pick an evolution.");
    if (target === NEW && (!title.trim() || !intent.trim())) reasons.push("Give the new evolution a title and an intent.");
  }
  if (!resuming && !adminToken) reasons.push("Set the admin token in the header.");

  /** The union of model nodes across every changed file: from the listing, else from the file itself. */
  const changedNodes = async (): Promise<string[]> => {
    const listed = new Map((tree.data?.files ?? []).map((f) => [f.path, f.nodes]));
    const perFile = await Promise.all(
      changes.map(async ({ path }) => {
        const known = listed.get(path);
        if (known?.length) return known;
        try {
          const f = await qc.fetchQuery({ queryKey: qk.file(systemId, repo, rev, path), queryFn: () => getFile(systemId, { repo, rev, path }) });
          return f.nodes ?? [];
        } catch {
          return []; // a new file has no base to read
        }
      }),
    );
    return [...new Set(perFile.flat())].sort();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reasons.length || commit.isPending) return;
    // Only a new Evolution needs its scope; the server's Genome check rejects Accept when it is empty.
    const affectedNodes = !resume?.evolutionId && target === NEW ? await changedNodes() : [];
    try {
      globalThis.localStorage?.setItem(NAME_KEY, name.trim());
    } catch {
      // Not important: the name is asked again next time.
    }
    const whyText = leaveToAgent ? undefined : why.trim();
    const body: EditorCommitRequest = { message: message.trim(), changes, author: name.trim(), ...(whyText && { why: whyText }) };
    // "author" is the editor's role on the wire; the model's AgentRole enum does not list it yet (the server stores it as given).
    const startWork = { agentLabel: `human:${name.trim()}`, target: repo, role: "author", origin: "editor" } as unknown as StartWorkRequest;
    const evolutionId = resume?.evolutionId ?? (target === NEW ? undefined : target);
    commit.mutate(
      {
        commit: body,
        target: repo,
        startWork,
        ...(adminToken && { adminToken }),
        ...(resuming && { realizationId: resume.realizationId, secret: resume.secret }),
        ...(evolutionId ? { evolutionId } : { newEvolution: { title: title.trim(), intent: intent.trim(), affectedNodes } }),
      },
      {
        onSuccess: (res) => {
          onResume(null);
          if (whyText) rememberWhy(systemId, res.realizationId, whyText);
          emitFx({ kind: "submitted", strength: 1.2 }, formRef.current);
          onCommitted();
          navigate(href("work", { ...(res.evolutionId && { evolution: res.evolutionId }), realization: res.realizationId }));
        },
        onError: (err) => {
          if (err instanceof ManualCommitError) onResume({ ...resume, ...err.progress });
        },
      },
    );
  };

  return (
    <Panel
      title={`Commit ${changes.length} file${changes.length === 1 ? "" : "s"}`}
      onBack={onClose}
      backLabel="Back to file"
      primary={
        <Button type="submit" form={`${uid}-form`} variant="primary" disabled={commit.isPending} reason={reasons[0]}>
          {commit.isPending ? "Committing…" : resume ? "Retry commit" : "Commit"}
        </Button>
      }
    >
      <p className={styles.muted}>
        The commit goes to a new editor realization's fork and becomes a candidate on Work. Realize it there with Promote or Accept.
      </p>
      {repo === "app" && <p><Link to={href("work", { panel: "plan", evolution: null, realization: null })}>Create a Realization Task</Link>. Your app draft stays here until you discard it.</p>}
      <form id={`${uid}-form`} ref={formRef} onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-m`}>Message</label>
          <Input id={`${uid}-m`} value={message} onChange={(e) => setMessage(e.target.value)} required autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${uid}-w`}>Why</label>
          <Textarea id={`${uid}-w`} value={why} onChange={(e) => setWhy(e.target.value)} rows={3} disabled={leaveToAgent} />
        </div>
        <label className={styles.check}>
          <Checkbox checked={leaveToAgent} onChange={(e) => setLeaveToAgent(e.target.checked)} /> Leave the rationale to the agent
        </label>
        {resume?.evolutionId ? (
          <p className={styles.muted}>Evolution <code>{resume.evolutionId}</code> (created by the last attempt).</p>
        ) : (
          <div className={styles.field}>
            <label htmlFor={`${uid}-e`}>Evolution</label>
            <Select id={`${uid}-e`} value={target} onChange={setTarget} options={[{ value: "", label: "Choose…" }, ...open.map((ev) => ({ value: ev.id, label: `${ev.title} (${ev.id})` })), { value: NEW, label: "New evolution…" }]} />
          </div>
        )}
        {!resume?.evolutionId && target === NEW && (
          <>
            <div className={styles.field}>
              <label htmlFor={`${uid}-t`}>Evolution title</label>
              <Input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${uid}-i`}>Evolution intent</label>
              <Textarea id={`${uid}-i`} value={intent} onChange={(e) => setIntent(e.target.value)} rows={2} />
            </div>
          </>
        )}
        <div className={styles.field}>
          <label htmlFor={`${uid}-n`}>Your name</label>
          <Input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        {resuming && <p className={styles.muted}>Retrying on realization <code>{resume!.realizationId}</code>.</p>}
        {commit.isError && <p role="alert" className={styles.error}>{commitError(commit.error)}</p>}
      </form>
    </Panel>
  );
}
