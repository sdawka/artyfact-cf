import { Select, Button, Checkbox, Input, Textarea } from "@/components/ui";
import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CreateEvolutionRequest, Evolution, WorkResponse } from "../../../../shared/api";
import { useAdminTokenField } from "@/api/adminToken";
import { qk, useCreateEvolution } from "@/api/queries";
import { useSystemRoute } from "@/model/useSelection";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { startWorkError } from "./StartWorkPanel";
import styles from "../work.module.css";

const KINDS = ["genome-amendment"] as const;
const RISKS = ["low", "medium", "high"] as const;

/** Admin form to propose a new Evolution; `onCreated` receives it (the caller selects it). */
export function NewEvolutionPanel({ onCreated, onCancel }: { onCreated(evolution: Evolution): void; onCancel?(): void }) {
  const uid = useId();
  const m = useModel();
  const create = useCreateEvolution();
  const qc = useQueryClient();
  const { systemId } = useSystemRoute();
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [nodeInput, setNodeInput] = useState("");
  const [nodes, setNodes] = useState<string[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("genome-amendment");
  const [risk, setRisk] = useState<(typeof RISKS)[number]>("medium");
  // null = list untouched: the field is omitted and the server applies the System's defaults for the target.
  const [picked, setPicked] = useState<string[] | null>(null);
  // Component state only: never persisted, cleared on success.
  const [adminToken, setAdminToken, resetAdminToken] = useAdminTokenField();

  const criteria = m.index.entries.filter((e) => e.kind === "criterion");

  const reason = m.bundle.source === "fixture"
    ? "Creating an Evolution needs the platform API. The UI is showing fixture data."
    : !title.trim() || !intent.trim()
      ? "Enter a title and an intent."
      : null;

  const addNode = () => {
    const id = nodeInput.trim();
    if (id && !nodes.includes(id)) setNodes([...nodes, id]);
    setNodeInput("");
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (reason) return;
    const body: CreateEvolutionRequest = { title: title.trim(), intent: intent.trim(), kind, risk, ...(nodes.length && { affectedNodes: nodes }), ...(picked && { acceptanceCriteria: picked }) };
    create.mutate(
      { body, ...(adminToken && { adminToken }) },
      {
        onSuccess: (res) => {
          resetAdminToken();
          // Show the card at once; the invalidated board refetch then replaces this entry.
          qc.setQueryData<WorkResponse>(qk.evolutions(systemId), (prev) =>
            prev && !prev.evolutions.some((e) => e.id === res.evolution.id) ? { ...prev, evolutions: [...prev.evolutions, res.evolution] } : prev);
          onCreated(res.evolution);
        },
      },
    );
  };

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>New Evolution</h2>
      <p className={styles.muted}>An Evolution changes the Genome. After acceptance, plan implementation in a separate Realization.</p>
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={`${uid}-t`}>Title</label>
          <Input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${uid}-i`}>Intent</label>
          <Textarea id={`${uid}-i`} value={intent} onChange={(e) => setIntent(e.target.value)} rows={3} required />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${uid}-n`}>Affected nodes</label>
          <span className={styles.inlineRow}>
            <Input
              id={`${uid}-n`}
              list={`${uid}-ids`}
              value={nodeInput}
              onChange={(e) => setNodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNode(); } }}
              autoComplete="off"
            />
            <Button type="button" variant="secondary" onClick={addNode} disabled={!nodeInput.trim()}>Add node</Button>
          </span>
          <datalist id={`${uid}-ids`}>
            {m.index.entries.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </datalist>
          {nodes.length > 0 && (
            <ul className={styles.chips} aria-label="Affected nodes">
              {nodes.map((id) => (
                <li key={id} className={styles.inlineRow}>
                  <NodeChip id={id} size="sm" interactive={false} showId />
                  <Button type="button" variant="secondary" aria-label={`Remove ${id}`} onClick={() => setNodes(nodes.filter((n) => n !== id))}>×</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {criteria.length > 0 && (
          <fieldset className={styles.fieldset}>
            <legend>Acceptance criteria</legend>
            <span className={styles.inlineRow}>
              <Button type="button" variant="secondary" onClick={() => setPicked(criteria.map((c) => c.id))}>Select all</Button>
              <Button type="button" variant="secondary" onClick={() => setPicked([])}>Clear</Button>
              <span className={styles.muted}>Leave untouched to use the System's defaults for this target</span>
            </span>
            <ul className={styles.plain}>
              {criteria.map((c) => (
                <li key={c.id}>
                  <label className={styles.check}>
                    <Checkbox
                      checked={!!picked?.includes(c.id)}
                      onChange={(e) => { const cur = picked ?? []; setPicked(e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)); }}
                    />
                    <code>{c.id}</code> <span className={styles.muted}>{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div className={styles.field}>
          <label htmlFor={`${uid}-k`}>Kind</label>
          <Select id={`${uid}-k`} value={kind} onChange={(value) => setKind(value as (typeof KINDS)[number])} options={KINDS.map((value) => ({ value, label: value }))} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${uid}-r`}>Risk</label>
          <Select id={`${uid}-r`} value={risk} onChange={(value) => setRisk(value as (typeof RISKS)[number])} options={RISKS.map((value) => ({ value, label: value }))} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${uid}-a`}>Admin token</label>
          <Input id={`${uid}-a`} type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} autoComplete="off" />
        </div>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={!!reason || create.isPending} aria-describedby={reason ? `${uid}-why` : undefined}>
            {create.isPending ? "Creating…" : "Create Evolution"}
          </Button>
          {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
          {reason && <span id={`${uid}-why`} className={styles.reason}>{reason}</span>}
        </div>
        {create.isError && <p role="alert" className={styles.error}>{startWorkError(create.error).replace("Start work", "Creating an Evolution")}</p>}
      </form>
    </section>
  );
}
