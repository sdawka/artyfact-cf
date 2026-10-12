import type { OntologyNode } from "@/model/types";
import { Field, ListField, NodeBodyFrame } from "./MapNodeParts";
import { registerBody, type BodyProps } from "./registry";

/** Affordance: actor, trigger, preconditions, effects and failure handling. */
function AffordanceBody({ entry }: BodyProps) {
  const n = entry.item as OntologyNode;
  return (
    <NodeBodyFrame entry={entry}>
      <Field label="Actor" value={n.actor} />
      <Field label="Trigger" value={n.trigger} />
      <ListField label="Preconditions" items={n.preconditions ?? []} />
      <ListField label="Effects" items={n.effects ?? []} />
      <ListField label="Failure" items={n.failure ?? []} />
    </NodeBodyFrame>
  );
}

registerBody("affordance", AffordanceBody);
