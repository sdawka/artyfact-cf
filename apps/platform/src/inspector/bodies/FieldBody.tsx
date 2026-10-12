import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { OntologyNode } from "@/model/types";
import { useModel } from "@/model/useModel";
import { Chips, Lines, Row, Stack, Text } from "./parts";

function FieldBody({ entry }: BodyProps) {
  const m = useModel();
  const n = entry.item as OntologyNode;
  const parent = m.parent(entry.id);
  // A Field node may restate its entity's declared field of the same name.
  const declared = (parent?.item as OntologyNode | undefined)?.fields?.find((f) => f.name === n.name);
  return (
    <Stack>
      <Text>{n.description}</Text>
      <Row label="Entity" show={!!parent}><Chips ids={parent ? [parent.id] : []} /></Row>
      <Row label="Type" show={!!declared}><code>{declared?.type}</code>{declared?.optional ? " (optional)" : ""}</Row>
      <Row label="Invariants" show={n.invariants.length > 0}><Lines items={n.invariants} /></Row>
    </Stack>
  );
}
registerBody("field", FieldBody);
