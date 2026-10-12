import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { OntologyNode } from "@/model/types";
import { useModel } from "@/model/useModel";
import { Chips, Row, Stack, Text } from "./parts";

function SectionBody({ entry }: BodyProps) {
  const m = useModel();
  const n = entry.item as OntologyNode;
  const children = m.children(entry.id);
  const roll = m.rollup(entry.id);
  const criteria = m.criteriaFor(entry.id);
  return (
    <Stack>
      <Text>{n.description}</Text>
      <Row label="Thing" show={!!n.owningThing}><Chips ids={n.owningThing ? [n.owningThing] : []} /></Row>
      <Row label="Contents"><Chips ids={children.map((c) => c.id)} /></Row>
      <Row label="Criteria" show={criteria.length > 0}><Chips ids={criteria.map((c) => c.id)} /></Row>
      <Row label="Conformance in this section">
        {roll.pass} pass · {roll.fail} fail · {roll.unknown + roll.stale} unknown · {roll.notRun} not run
      </Row>
    </Stack>
  );
}
registerBody("section", SectionBody);
