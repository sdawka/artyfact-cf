import { Select, Button, Input } from "@/components/ui";
import { Panel } from "@/components/Panel/Panel";
import { useId, useState } from "react";
import type { Evolution, Realization, StartWorkRequest, StartWorkResponse } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { useStartWork } from "@/api/queries";
import { ApiRequestError } from "@/api/client";
import { useModel } from "@/model/useModel";
import { PacketViewer, type PacketViewerProps } from "./PacketViewer";
import { STARTABLE } from "../lib";
import styles from "../work.module.css";

const ROLES = ["implementer", "assay-author", "verifier", "reviewer", "repairer"] as const;
export const TOKEN_REASON = "Set the admin token in the header.";

export interface StartedWork extends PacketViewerProps {
  realization: Realization;
}

/** Accepts both the token-object and the flat `token` response shapes; the command comes only from `cli`. */
export function normalizeStartWork(res: StartWorkResponse): StartedWork {
  const r = res as unknown as {
    realization: Realization;
    packet?: { markdown?: string };
    token?: string | { value?: string; expiresAt?: string; remote?: string };
    remote?: string;
    cli?: string;
  };
  const tok = typeof r.token === "string" ? { value: r.token } : (r.token ?? {});
  // `cli` is the server's ready-to-paste line. Never build one here: flags would drift from the real CLI.
  const cli = r.cli ?? null;
  return {
    realization: r.realization,
    markdown: r.packet?.markdown ?? "",
    cli,
    expiresAt: r.realization.workspace.tokenExpiresAt ?? ("expiresAt" in tok ? tok.expiresAt : undefined),
    remote: r.remote ?? ("remote" in tok ? tok.remote : undefined) ?? r.realization.workspace.fork,
  };
}

/** Plain wording for the two auth refusals; anything else keeps the server's message. */
export function startWorkError(err: Error): string {
  if (err instanceof ApiRequestError && err.status === 401) return "Start work needs the admin token (401). Set the admin token in the header and try again.";
  if (err instanceof ApiRequestError && err.status === 403) return "The admin token was refused (403). Check it in the header and try again.";
  return err.message;
}

/**
 * Start work on an Evolution: replaces the detail's Attempts region ("Back to Evolution"). On success shows the Task
 * Packet and the one-time command. Writes use the header's admin token.
 */
export function StartWorkPanel({ evolution, onBack }: { evolution: Evolution; onBack(): void }) {
  const uid = useId();
  const m = useModel();
  const start = useStartWork();
  const { token } = useAdminToken();
  const genomeOnly = evolution.kind === "genome-amendment";
  const [agentLabel, setAgentLabel] = useState("");
  const [target, setTarget] = useState<"app" | "genome">(genomeOnly ? "genome" : "app");
  const [role, setRole] = useState<(typeof ROLES)[number]>("implementer");
  const [started, setStarted] = useState<StartedWork | null>(null);

  const reason = m.bundle.source === "fixture"
    ? "Start work needs the platform API. The UI is showing fixture data."
    : !STARTABLE.has(evolution.state)
      ? `${evolution.id} is ${evolution.state}; it must be actionable before work starts.`
      : !token
        ? TOKEN_REASON
        : null;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (reason) return;
    const body: StartWorkRequest = { target: genomeOnly ? "genome" : target, role, ...(agentLabel.trim() && { agentLabel: agentLabel.trim() }) };
    start.mutate({ evolutionId: evolution.id, body, adminToken: token }, { onSuccess: (res) => setStarted(normalizeStartWork(res)) });
  };

  return (
    <Panel title={`Start work on ${evolution.title}`} headingLevel={3} onBack={onBack} backLabel="Back to Evolution">
      {!started && (
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor={`${uid}-a`}>Agent label</label>
            <Input id={`${uid}-a`} value={agentLabel} onChange={(e) => setAgentLabel(e.target.value)} placeholder="e.g. codex-1" autoComplete="off" />
          </div>
          {genomeOnly ? (
            <p className={styles.muted}>Target <code>genome</code>: a Genome Evolution changes the Genome only.</p>
          ) : (
            <div className={styles.field}>
              <label htmlFor={`${uid}-t`}>Target</label>
              <Select id={`${uid}-t`} value={target} onChange={(value) => setTarget(value as "app" | "genome")} options={[{ value: "app", label: "app" }, { value: "genome", label: "genome" }]} />
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor={`${uid}-r`}>Role</label>
            <Select id={`${uid}-r`} value={role} onChange={(value) => setRole(value as (typeof ROLES)[number])} options={ROLES.map((value) => ({ value, label: value }))} />
          </div>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={start.isPending} reason={reason ?? undefined}>
              {start.isPending ? "Starting…" : "Start work"}
            </Button>
          </div>
          {start.isError && <p role="alert" className={styles.error}>{startWorkError(start.error)}</p>}
        </form>
      )}
      {started && (
        <>
          <p>Started <code>{started.realization.id}</code> as <strong>{started.realization.agent.id}</strong>.</p>
          <PacketViewer markdown={started.markdown} cli={started.cli} expiresAt={started.expiresAt} remote={started.remote} />
        </>
      )}
    </Panel>
  );
}
