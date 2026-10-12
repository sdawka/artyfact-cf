import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { Requirement } from "@/model/types";
import { Chips, Row, Stack, Text } from "./parts";

function RequirementBody({ entry }: BodyProps) {
  const r = entry.item as Requirement;
  return (
    <Stack>
      <Text>{r.text}</Text>
      <Row label="Thing"><Chips ids={[r.thing]} /></Row>
      <Row label="Refines (GD)"><Chips ids={r.refines} /></Row>
      <Row label="Subjects"><Chips ids={r.subjects} /></Row>
      <Row label="Enabled">{r.enabled ? "yes" : "no"}</Row>
    </Stack>
  );
}
registerBody("requirement", RequirementBody);
