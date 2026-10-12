import type { OntologyNode } from "@/model/types";
import { Field, ListField, NodeBodyFrame } from "@/views/map/bodyParts/MapNodeParts";
import { registerBody, type BodyProps } from "./registry";

/** Screen: route, roles and states, then the components inside. */
function ScreenBody({ entry }: BodyProps) {
  const n = entry.item as OntologyNode;
  return (
    <NodeBodyFrame entry={entry}>
      <Field label="Route" value={n.route} code />
      <ListField label="Roles" items={n.roles ?? []} inline />
      <ListField label="States" items={n.states ?? []} inline />
    </NodeBodyFrame>
  );
}

registerBody("screen", ScreenBody);
