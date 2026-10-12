import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { SystemFile } from "@/model/types";
import { Chips, Row, Stack } from "./parts";

function SystemBody({ entry }: BodyProps) {
  const s = entry.item as SystemFile;
  return (
    <Stack>
      <Row label="Template">{s.template ? <code>{s.template}</code> : "none"}</Row>
      <Row label="Phase">{s.phase}</Row>
      <Row label="Profile" show={!!s.profile}>{s.profile}</Row>
      <Row label="Things"><Chips ids={s.things} /></Row>
      <Row label="Purposes"><Chips ids={s.purposes} /></Row>
    </Stack>
  );
}
registerBody("system", SystemBody);
