import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { AssayHook } from "@/model/types";
import { Chips, Row, Stack, Text } from "./parts";
import { KeyValue } from "@/components/KeyValue/KeyValue";

function HookBody({ entry }: BodyProps) {
  const h = entry.item as AssayHook;
  return (
    <Stack>
      <Text>{h.assay}</Text>
      <Row label="Engine · tier">{h.engine} · {h.tier}</Row>
      <Row label="Binding">{h.binding}</Row>
      <Row label="Target">{h.targetKind}</Row>
      <Row label="Triggers">{h.triggers.join(", ") || "none"}</Row>
      <Row label="Cost">{h.costTier} · timeout {h.timeoutMs} ms</Row>
      <Row label="Criteria"><Chips ids={h.criteria} /></Row>
      <Row label="Inputs" show={Object.keys(h.inputs).length > 0}><KeyValue data={h.inputs} /></Row>
    </Stack>
  );
}
registerBody("hook", HookBody);
