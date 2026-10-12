import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { Purpose } from "@/model/types";
import { Bullets, Chips, Field, Fields, Muted } from "./BodyFields";
import { registerBody, type BodyProps } from "./registry";

/** What-tab body for a purpose: statement, intended change, criteria and boundaries. */
function PurposeBody({ entry }: BodyProps) {
  const p = entry.item as Purpose;
  return (
    <Fields>
      <Field label="Statement">{p.statement}</Field>
      <Field label="Intended change">{p.intendedChange}</Field>
      <Field label="Beneficiaries">
        <Chips>
          {p.beneficiaries.map((id) => (
            <NodeChip key={id} id={id} size="sm" />
          ))}
        </Chips>
      </Field>
      <Field label="Success criteria">
        <Bullets items={p.successCriteria} />
      </Field>
      <Field label="Non-goals">
        <Bullets items={p.nonGoals} />
      </Field>
      <Field label="Constraints">
        <Bullets items={p.constraints} />
      </Field>
      <Field label="Observations">
        <Muted>none yet — unknown</Muted>
      </Field>
    </Fields>
  );
}

registerBody("purpose", PurposeBody);
