import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { OntologyNode } from "@/model/types";
import { useModel } from "@/model/useModel";
import { Chips, Row, Stack, Text } from "./parts";

function BindingBody({ entry }: BodyProps) {
  const m = useModel();
  const n = entry.item as OntologyNode;
  const links = m.crossLinks(entry.id);
  const storing = links.filter((l) => l.rel === "storedIn" && l.to === entry.id).map((l) => l.from);
  const others = links.filter((l) => l.rel !== "storedIn" || l.to !== entry.id).map((l) => (l.from === entry.id ? l.to : l.from));
  return (
    <Stack>
      <Text>{n.description}</Text>
      <Row label="Stores"><Chips ids={storing} /></Row>
      <Row label="Linked" show={others.length > 0}><Chips ids={[...new Set(others)]} /></Row>
      <Row label="Owning Thing" show={!!n.owningThing}><Chips ids={n.owningThing ? [n.owningThing] : []} /></Row>
    </Stack>
  );
}
registerBody("binding", BindingBody);
