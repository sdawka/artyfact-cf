import { useState, useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminToken } from "@/api/adminToken";
import { scopedRequest } from "@/api/lifecycle";
import { Check, formStyles } from "@/components/Form/Form";
import { Panel } from "@/components/Panel/Panel";
import { Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { useSystemRoute } from "@/model/useSelection";
import { operationsPaths, type CreateFlagRequest, type FlagRule, type OperationalFlag, type UpdateFlagRequest } from "../../../shared/operations";

/** The flag editor. It replaces the flags list ("Back to flags"), with its own heading and its own primary. `flag` null creates. */
export function FlagForm({ flag, binding, enabled, onBack }: { flag: OperationalFlag | null; binding: string; enabled: boolean; onBack: () => void }) {
  const { systemId } = useSystemRoute();
  const { token } = useAdminToken();
  const qc = useQueryClient();
  const formId = useId();
  const variations = Object.keys(flag?.variations ?? { off: false, on: true });
  const [key, setKey] = useState(flag?.key ?? "");
  const [description, setDescription] = useState(flag?.description ?? "");
  const [reason, setReason] = useState("");
  const [rules, setRules] = useState(JSON.stringify(flag?.rules ?? [], null, 2));
  const [defaultVariation, setDefaultVariation] = useState(flag?.default_variation ?? "off");
  const [flagEnabled, setFlagEnabled] = useState(flag?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (disable = false) => {
    if (!enabled || !binding) return;
    setBusy(true);
    setError("");
    try {
      if (flag) {
        const body: UpdateFlagRequest = {
          expectedVersion: flag.version,
          reason,
          patch: disable ? { enabled: false } : { enabled: flagEnabled, default_variation: defaultVariation, description, rules: JSON.parse(rules) as FlagRule[] },
        };
        await scopedRequest(operationsPaths.flag(systemId, binding, flag.key), token, "PATCH", body);
      } else {
        const body: CreateFlagRequest = {
          reason,
          flag: { key, description, enabled: flagEnabled, default_variation: defaultVariation, variations: { off: false, on: true }, rules: JSON.parse(rules) as FlagRule[] },
        };
        await scopedRequest(operationsPaths.flags(systemId, binding), token, "POST", body);
      }
      onBack();
      await qc.invalidateQueries({ queryKey: ["operations"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const noReason = !reason.trim() ? "Enter a change reason." : undefined;
  return (
    <Panel
      title={flag ? `Edit ${flag.key}` : "Create boolean flag"}
      headingLevel={3}
      onBack={onBack}
      backLabel="Back to flags"
      secondary={flag && <Button variant="danger" disabled={!enabled || busy} reason={noReason} onClick={() => void save(true)}>Disable flag</Button>}
      primary={<Button type="submit" form={formId} variant="primary" disabled={!enabled || busy} reason={noReason}>{busy ? "Saving…" : "Save flag"}</Button>}
    >
      <form id={formId} className={formStyles.form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className={formStyles.field}>
          <label htmlFor="flag-key">Flag key</label>
          <Input id="flag-key" value={key} onChange={(e) => setKey(e.target.value)} required disabled={!!flag || busy} />
        </div>
        <div className={formStyles.field}>
          <label htmlFor="flag-description">Description</label>
          <Input id="flag-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        </div>
        <Check><Checkbox checked={flagEnabled} onChange={(e) => setFlagEnabled(e.target.checked)} disabled={busy} />Enabled</Check>
        <div className={formStyles.field}>
          <label htmlFor="flag-default">Fallback variation</label>
          <Select id="flag-default" value={defaultVariation} onChange={setDefaultVariation} disabled={busy} options={variations.map((value) => ({ value, label: value }))} />
        </div>
        <details>
          <summary>Edit targeting and percentage rollout</summary>
          <p>Rules match request attributes. Each rule has conditions, priority, a variation to serve, and an optional rollout percentage from 0 to 100.</p>
          <div className={formStyles.field}>
            <label htmlFor="flag-rules">Targeting rules</label>
            <Textarea id="flag-rules" rows={8} value={rules} onChange={(e) => setRules(e.target.value)} disabled={busy} />
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setRules(JSON.stringify([{ conditions: [], priority: 1, serve_variation: variations[1] ?? defaultVariation, rollout: { percentage: 10, attribute: "userId" } }], null, 2))}
          >
            Use 10% rollout example
          </Button>
        </details>
        <div className={formStyles.field}>
          <label htmlFor="flag-reason">Change reason</label>
          <Textarea id="flag-reason" value={reason} onChange={(e) => setReason(e.target.value)} required disabled={busy} />
        </div>
        {error && <p role="alert" className={formStyles.error}>{error}</p>}
      </form>
    </Panel>
  );
}
