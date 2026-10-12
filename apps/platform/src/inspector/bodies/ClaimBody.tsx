import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { TheoryClaim } from "@/model/types";
import { ClaimStatus } from "@/views/theory/ClaimStatus";
import { Chips, Field, Fields, Muted } from "./BodyFields";
import { registerBody, type BodyProps } from "./registry";

const chips = (ids: readonly string[]) =>
  ids.length ? (
    <Chips>
      {ids.map((id) => (
        <NodeChip key={id} id={id} size="sm" />
      ))}
    </Chips>
  ) : (
    <Muted>none</Muted>
  );

/** What-tab body for a theory claim: the whole chain from mechanism to limitation. */
function ClaimBody({ entry }: BodyProps) {
  const c = entry.item as TheoryClaim;
  return (
    <Fields>
      <Field label="Status">
        <ClaimStatus status={c.status} /> {c.kind}
        {c.deferred && ", deferred"}
      </Field>
      <Field label="Purpose">{chips([c.purpose])}</Field>
      <Field label="Mechanism">{c.mechanism}</Field>
      <Field label="Beneficiaries">{chips(c.beneficiaries)}</Field>
      <Field label="Activities">{chips(c.activities)}</Field>
      <Field label="Outcome">{c.outcome}</Field>
      <Field label="Indicator">{c.indicator}</Field>
      <Field label="Evaluation method">{c.evaluationMethod}</Field>
      <Field label="Limitation">{c.limitation}</Field>
      <Field label="Horizon">
        <Muted>unknown: the model records no horizon for this claim</Muted>
      </Field>
      <Field label="Observations">
        <Muted>none yet — unknown</Muted>
      </Field>
    </Fields>
  );
}

registerBody("claim", ClaimBody);
