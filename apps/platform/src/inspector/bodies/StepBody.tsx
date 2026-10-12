import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { JourneyStep } from "@/model/types";
import { useModel } from "@/model/useModel";
import { useSelection } from "@/model/useSelection";
import { Bullets, Chips, Field, Fields, Muted } from "./BodyFields";
import { registerBody, type BodyProps } from "./registry";

const ACTORS = { user: "User", system: "System", external: "External", counterpart: "Counterpart" } as const;

/** What-tab body for a journey step. Context chips open the node in the Map. */
function StepBody({ entry }: BodyProps) {
  const step = entry.item as JourneyStep;
  const { setFocus } = useSelection();
  const model = useModel();
  const journeyId = entry.id.split("/")[0]!;
  const context = [step.screen, step.operation, step.external].filter((r): r is string => !!r);
  const openInMap = (id: string) => setFocus(id, { view: "map" });
  return (
    <Fields>
      <Field label="Action">{step.action}</Field>
      <Field label="Journey">
        <NodeChip id={journeyId} size="sm" />
      </Field>
      <Field label="Actor">
        {ACTORS[step.actor]}, {step.kind}
        {step.unresolved && " (provisional, unresolved)"}
      </Field>
      <Field label="Context (opens in Map)">
        {context.length ? (
          <Chips>
            {context.map((id) => (
              <NodeChip key={id} id={id} onSelect={openInMap} />
            ))}
          </Chips>
        ) : (
          <Muted>none declared</Muted>
        )}
      </Field>
      {step.state && <Field label="State">{step.state}</Field>}
      <Field label="Requirements">
        {step.requirementRefs.length ? (
          <Chips>
            {step.requirementRefs.map((id) => (
              <NodeChip key={id} id={id} size="sm" />
            ))}
          </Chips>
        ) : (
          <Muted>none</Muted>
        )}
      </Field>
      <Field label="Next">
        <Bullets
          empty="end of the journey"
          items={step.next.map((n) => {
            const target = model.byId(`${journeyId}/${n.to}`);
            return `${n.to}${target ? `: ${target.name}` : ""}${n.when ? ` (${n.when})` : ""}`;
          })}
        />
      </Field>
    </Fields>
  );
}

registerBody("step", StepBody);
