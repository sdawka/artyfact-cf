import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { Criterion } from "@/model/types";
import { useModel } from "@/model/useModel";
import { Chips, Row, Stack, Text } from "./parts";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import styles from "./Bodies.module.css";

function CriterionBody({ entry }: BodyProps) {
  const m = useModel();
  const c = entry.item as Criterion;
  const hooks = m.hooksFor(c.id);
  return (
    <Stack>
      <Text>{c.claim}</Text>
      <Row label="Severity">{c.severity}{c.deferred ? " · deferred" : ""}</Row>
      <Row label="Gates">{c.gates.join(", ") || "none"}</Row>
      <Row label="Target">{c.targetKind}</Row>
      <Row label="Applicable when" show={!!c.applicableWhen}>{c.applicableWhen}</Row>
      <Row label="Hooks">
        {hooks.length ? (
          <ul className={styles.plain}>
            {hooks.map((h) => (
              <li key={h.id} className={styles.hook}>
                <NodeChip id={h.id} size="sm" />
                <span className={styles.hookMeta}>{h.engine} · {h.tier} · {h.binding}</span>
              </li>
            ))}
          </ul>
        ) : <span className={styles.muted}>none</span>}
      </Row>
      <Row label="Refines" show={c.refines.length > 0}><Chips ids={c.refines} /></Row>
      <Row label="Satisfies" show={c.satisfies.length > 0}><Chips ids={c.satisfies} /></Row>
    </Stack>
  );
}
registerBody("criterion", CriterionBody);
