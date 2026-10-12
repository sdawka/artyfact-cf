import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { External } from "@/model/types";
import { useModel } from "@/model/useModel";
import { Chips, Row, Stack } from "./parts";

function ExternalBody({ entry }: BodyProps) {
  const m = useModel();
  const x = entry.item as External;
  const linked = m.crossLinks(x.id).map((l) => (l.from === x.id ? l.to : l.from)).filter((id, i, xs) => xs.indexOf(id) === i);
  return (
    <Stack>
      <Row label="Kind">{x.kind}</Row>
      <Row label="What we model">{x.modeled}</Row>
      <Row label="Outside our control">{x.external}</Row>
      <Row label="Links"><Chips ids={linked} /></Row>
    </Stack>
  );
}
registerBody("external", ExternalBody);
