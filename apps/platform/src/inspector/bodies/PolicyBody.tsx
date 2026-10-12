import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { OntologyNode } from "@/model/types";
import { Chips, MutedValue, Row, Stack, Text, useLinked } from "./parts";

function PolicyBody({ entry }: BodyProps) {
  const n = entry.item as OntologyNode;
  const governs = useLinked(entry, "governs", "out");
  return (
    <Stack>
      <Text>{n.description}</Text>
      <Row label="Mode"><MutedValue value={n.mode} /></Row>
      <Row label="Governs"><Chips ids={governs} /></Row>
      <Row label="Roles"><Chips ids={n.roles} /></Row>
    </Stack>
  );
}
registerBody("policy", PolicyBody);
