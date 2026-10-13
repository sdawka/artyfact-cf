import { useId, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { EditorCommitRequest, FileScope, StartWorkRequest } from "../../../shared/api";
import { useAdminTokenField } from "@/api/adminToken";
import { ApiRequestError, FixtureModeError, getFile } from "@/api/client";
import { ManualCommitError, useEvolutions, useManualCommit, useTree, qk, type ManualCommitProgress } from "@/api/queries";
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

/** Commit the draft: message, why, target Evolution (or a new one), name, admin token; then a candidate on Work. */
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
  // Pre-filled from the header token; a typed value is a one-off.
  const [adminToken, setAdminToken, resetAdminToken] = useAdminTokenField();

  const open = (evolutions.data?.evolutions ?? []).filter((e) => STARTABLE.has(e.state));
  const resuming = !!resume?.realizationId && !!resume.secret;

  const reasons: string[] = [];
  if (fixture) reasons.push("Commit needs the platform API.");
  if (!changes.length) reasons.push("There are no pending changes.");
  if (!message.trim()) reasons.push("Write a commit message.");
  if (!leaveToAgent && !why.trim()) reasons.push("Say why, or leave the rationale to the agent.");
  if (!name.trim()) reasons.push("Enter your name.");
  if (!resume?.evolutionId) {
    if (!target) reasons.push("Pick an evolution.");
    if (target === NEW && (!title.trim() || !intent.trim())) reasons.push("Give the new evolution a title and an intent.");
  }
  if (!resuming && !adminToken) reasons.push("Enter the admin token.");

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
          resetAdminToken();
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
    <section className={styles.sheet} aria-labelledby={`${uid}-h`}>
      <div className={styles.sheetHead}>
        <h2 id={`${uid}-h`}>Commit {changes.length} file{changes.length === 1 ? "" : "s"}</h2>
        <button type="button" className={`u-brackets ${styles.btn}`} onClick={onClose}>Close</button>
      </div>
      <p className={styles.muted}>
        The commit goes to a new editor realization's fork and becomes a candidate on Work. Realize it there with Promote or Accept.
      </p>
      <form ref={formRef} onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-m`}>Message</label>
          <input id={`${uid}-m`} value={message} onChange={(e) => setMessage(e.target.value)} required autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${uid}-w`}>Why</label>
          <textarea id={`${uid}-w`} value={why} onChange={(e) => setWhy(e.target.value)} rows={3} disabled={leaveToAgent} />
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={leaveToAgent} onChange={(e) => setLeaveToAgent(e.target.checked)} /> Leave the rationale to the agent
        </label>
        {resume?.evolutionId ? (
          <p className={styles.muted}>Evolution <code>{resume.evolutionId}</code> (created by the last attempt).</p>
        ) : (
          <div className={styles.field}>
            <label htmlFor={`${uid}-e`}>Evolution</label>
            <select id={`${uid}-e`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {open.map((ev) => <option key={ev.id} value={ev.id}>{ev.title} ({ev.id})</option>)}
              <option value={NEW}>New evolution…</option>
            </select>
          </div>
        )}
        {!resume?.evolutionId && target === NEW && (
          <>
            <div className={styles.field}>
              <label htmlFor={`${uid}-t`}>Evolution title</label>
              <input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${uid}-i`}>Evolution intent</label>
              <textarea id={`${uid}-i`} value={intent} onChange={(e) => setIntent(e.target.value)} rows={2} />
            </div>
          </>
        )}
        <div className={styles.field}>
          <label htmlFor={`${uid}-n`}>Your name</label>
          <input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        {!resuming && (
          <div className={styles.field}>
            <label htmlFor={`${uid}-k`}>Admin token</label>
            <input id={`${uid}-k`} type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} autoComplete="off" />
          </div>
        )}
        {resuming && <p className={styles.muted}>Retrying on realization <code>{resume!.realizationId}</code>.</p>}
        <div className={styles.actions}>
          <button type="submit" className={`u-brackets ${styles.primary}`} disabled={reasons.length > 0 || commit.isPending} aria-describedby={reasons.length ? `${uid}-why` : undefined}>
            {commit.isPending ? "Committing…" : resume ? "Retry commit" : "Commit"}
          </button>
        </div>
        {reasons.length > 0 && (
          <ul id={`${uid}-why`} className={styles.reasons} aria-label="Why commit is disabled">
            {reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        {commit.isError && <p role="alert" className={styles.error}>{commitError(commit.error)}</p>}
      </form>
    </section>
  );
}
