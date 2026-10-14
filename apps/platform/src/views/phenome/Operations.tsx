import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminToken } from "@/api/adminToken";
import { scopedRequest } from "@/api/lifecycle";
import { formStyles } from "@/components/Form/Form";
import { Section } from "@/components/Section/Section";
import { Button, Input, Select } from "@/components/ui";
import { useModel } from "@/model/useModel";
import { useSystemRoute } from "@/model/useSelection";
import { operationsPaths, type OperationsBindingsResponse } from "../../../shared/operations";
import { BindingOperations } from "./BindingOperations";
import styles from "./phenome.module.css";

/** Runtime metrics and feature flags. `thingId` limits the bindings to that Thing's artifacts. Remounts per scope. */
export function Operations({ thingId }: { thingId?: string }) {
  const { systemId, rev } = useSystemRoute();
  return <ScopedOperations key={`${systemId}/${rev}/${thingId ?? ""}`} thingId={thingId} />;
}

/** Why nothing loads yet, with a field to set the token right here. */
function TokenGate() {
  const { setToken } = useAdminToken();
  const [draft, setDraft] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) setToken(draft);
    setDraft("");
  };
  return (
    <form className={styles.tokenGate} onSubmit={submit}>
      <p className={styles.quiet}>Observations and flag controls need the admin token.</p>
      <div className={formStyles.field}>
        <label htmlFor="operations-token">Admin token</label>
        <Input id="operations-token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
      <Button type="submit" reason={draft.trim() ? undefined : "Enter the admin token."}>Set admin token</Button>
    </form>
  );
}

function ScopedOperations({ thingId }: { thingId?: string }) {
  const { systemId } = useSystemRoute();
  const { token } = useAdminToken();
  const model = useModel();
  const enabled = !!token && model.bundle.source === "api";
  const [picked, setPicked] = useState("");
  const bindings = useQuery({
    queryKey: ["operation-bindings", systemId, token],
    queryFn: () => scopedRequest<OperationsBindingsResponse>(operationsPaths.bindings(systemId), token),
    enabled,
  });
  const artifacts = thingId ? new Set(model.bundle.model.things.find((t) => t.id === thingId)?.artifacts.map((a) => a.artifact) ?? []) : null;
  const eligible = bindings.data?.bindings.filter((b) => !artifacts || artifacts.has(b.bindingId)) ?? [];
  const binding = eligible.some((b) => b.bindingId === picked) ? picked : (eligible[0]?.bindingId ?? "");
  return (
    <Section
      surface="panel"
      title="Operations"
      description="Runtime metrics and feature flags. Observe your running app and change its Flagship controls independently of Genome Evolutions. Counts do not prove expected effects."
      id="operations"
    >
      {!enabled && (token ? <p className={styles.quiet}>Operations need the platform API. The UI is showing fixture data.</p> : <TokenGate />)}
      {bindings.isLoading && <p role="status" className={styles.quiet}>Loading operational bindings…</p>}
      {bindings.error && <p role="alert" className={styles.errorText}>{(bindings.error as Error).message}</p>}
      {bindings.data && !binding && <p className={styles.quiet}>{thingId ? "No operational bindings for this Thing." : "No operational bindings for this System."}</p>}
      {!!binding && (
        <>
          <div className={formStyles.field}>
            <label htmlFor="operation-binding">Artifact binding</label>
            <Select
              id="operation-binding"
              value={binding}
              onChange={setPicked}
              options={eligible.map((b) => ({ value: b.bindingId, label: `${b.bindingId}${b.configured ? "" : " (not configured)"}` }))}
            />
          </div>
          <BindingOperations key={binding} binding={binding} enabled={enabled} />
        </>
      )}
    </Section>
  );
}
