import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { OntologyNode } from "@/model/types";
import { Chips, Lines, MutedValue, Row, Stack, Text, useLinked } from "./parts";

function OperationBody({ entry }: BodyProps) {
  const n = entry.item as OntologyNode;
  const invokedBy = useLinked(entry, "invokes", "in");
  const reads = useLinked(entry, "reads", "out");
  const writes = useLinked(entry, "writes", "out");
  return (
    <Stack>
      <Text>{n.description}</Text>
      <Row label="Actor"><MutedValue value={n.actor} /></Row>
      <Row label="Trigger"><MutedValue value={n.trigger} /></Row>
      <Row label="Preconditions"><Lines items={n.preconditions} /></Row>
      <Row label="Effects"><Lines items={n.effects} /></Row>
      <Row label="Failure"><Lines items={n.failure} /></Row>
      <Row label="Invoked by"><Chips ids={invokedBy} /></Row>
      <Row label="Reads"><Chips ids={reads} /></Row>
      <Row label="Writes"><Chips ids={writes} /></Row>
    </Stack>
  );
}
registerBody("operation", OperationBody);
