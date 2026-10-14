import { Button, Checkbox, IconButton, Input, Textarea } from "@/components/ui";
import { useId, useState } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import type { CreateEvolutionRequest, Evolution, WorkResponse } from "../../../../shared/api";
import { useAdminToken } from "@/api/adminToken";
import { qk, useCreateEvolution } from "@/api/queries";
import { Panel } from "@/components/Panel/Panel";
import { useSystemRoute } from "@/model/useSelection";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { startWorkError, TOKEN_REASON } from "./StartWorkPanel";
import styles from "../work.module.css";

const RISKS = ["low", "medium", "high"] as const;

/**
 * Propose a new Genome Evolution by hand; `onCreated` receives it (the caller selects it). A Panel that replaces the
 * region it is about; `onCancel` is its back link (`backLabel` names that region, default "Back").
 * Acceptance criteria default to the System's for the target until the person chooses them.
 */
export function NewEvolutionPanel({ onCreated, onCancel, backLabel = "Back" }: { onCreated(evolution: Evolution): void; onCancel?(): void; backLabel?: string }) {
  const uid = useId();
  const m = useModel();
  const create = useCreateEvolution();
  const qc = useQueryClient();
  const { systemId } = useSystemRoute();
  const { token } = useAdminToken();
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [nodeInput, setNodeInput] = useState("");
  const [nodes, setNodes] = useState<string[]>([]);
  const [risk, setRisk] = useState<(typeof RISKS)[number]>("medium");
  // null = the System's defaults: the field is omitted and the server applies them for the target.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");

  const criteria = m.index.entries.filter((e) => e.kind === "criterion");
  const q = filter.trim().toLowerCase();
  const shown = q ? criteria.filter((c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : criteria;

  const reason = m.bundle.source === "fixture"
    ? "Creating an Evolution needs the platform API. The UI is showing fixture data."
    : !token
      ? TOKEN_REASON
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
    const body: CreateEvolutionRequest = { title: title.trim(), intent: intent.trim(), kind: "genome-amendment", risk, ...(nodes.length && { affectedNodes: nodes }), ...(picked && { acceptanceCriteria: picked }) };
    create.mutate(
      { body, adminToken: token },
      {
        onSuccess: (res) => {
          // Show the row at once; the invalidated board refetch then replaces this entry.
          qc.setQueryData<WorkResponse>(qk.evolutions(systemId), (prev) =>
            prev && !prev.evolutions.some((e) => e.id === res.evolution.id) ? { ...prev, evolutions: [...prev.evolutions, res.evolution] } : prev);
          onCreated(res.evolution);
        },
      },
    );
  };

  return (
    <Panel title="New Evolution" {...(onCancel && { onBack: onCancel, backLabel })}>
      <p className={styles.listNote}>An Evolution changes the Genome. After acceptance, plan the implementation as a Plan in Work.</p>
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
                  <IconButton label={`Remove ${id}`} variant="ghost" size="compact" onClick={() => setNodes(nodes.filter((n) => n !== id))}><Cross2Icon aria-hidden="true" /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
        {criteria.length > 0 && (
          <fieldset className={styles.choice}>
            <legend>Acceptance criteria</legend>
            <p className={styles.listNote} role="status">
              {picked === null ? "Using the System's defaults for this target." : `${picked.length} of ${criteria.length} chosen.`}
              {picked !== null && <> <Button variant="ghost" size="compact" onClick={() => setPicked(null)}>Use the System's defaults</Button></>}
            </p>
            <details className={styles.disclosure}>
              <summary>Choose criteria</summary>
              <div className={styles.disclosureBody}>
                <div className={styles.field}>
                  <label htmlFor={`${uid}-f`}>Filter criteria</label>
                  <Input id={`${uid}-f`} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
                </div>
                <span className={styles.inlineRow}>
                  <Button variant="ghost" size="compact" onClick={() => setPicked(criteria.map((c) => c.id))}>Select all</Button>
                  <Button variant="ghost" size="compact" onClick={() => setPicked([])}>Clear</Button>
                </span>
                <ul className={styles.plain}>
                  {shown.map((c) => (
                    <li key={c.id}>
                      <label className={styles.check}>
                        <Checkbox
                          checked={!!picked?.includes(c.id)}
                          onChange={(e) => { const cur = picked ?? []; setPicked(e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)); }}
                        />
                        <span>{c.name} <code className={styles.idMeta}>{c.id}</code></span>
                      </label>
                    </li>
                  ))}
                  {shown.length === 0 && <li className={styles.listNote}>No criterion matches “{filter}”.</li>}
                </ul>
              </div>
            </details>
          </fieldset>
        )}
        <fieldset className={styles.choice}>
          <legend>Risk</legend>
          <span className={styles.radios}>
            {RISKS.map((r) => (
              <label key={r} className={styles.check}>
                <input type="radio" name={`${uid}-risk`} value={r} checked={risk === r} onChange={() => setRisk(r)} /> {r}
              </label>
            ))}
          </span>
        </fieldset>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={create.isPending} reason={reason ?? undefined}>
            {create.isPending ? "Creating…" : "Create Evolution"}
          </Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
        {create.isError && <p role="alert" className={styles.error}>{startWorkError(create.error).replace("Start work", "Creating an Evolution")}</p>}
      </form>
    </Panel>
  );
}
