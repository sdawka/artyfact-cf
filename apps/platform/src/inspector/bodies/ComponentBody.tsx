import type { OntologyNode } from "@/model/types";
import { Field, ListField, NodeBodyFrame } from "@/views/map/bodyParts/MapNodeParts";
import { registerBody, type BodyProps } from "./registry";

/** Component: cardinality (and states when declared), then what it contains. */
function ComponentBody({ entry }: BodyProps) {
  const n = entry.item as OntologyNode;
  return (
    <NodeBodyFrame entry={entry}>
      <Field label="Cardinality" value={n.cardinality} />
      {(n.states ?? []).length > 0 && <ListField label="States" items={n.states} inline />}
    </NodeBodyFrame>
  );
}

registerBody("component", ComponentBody);
