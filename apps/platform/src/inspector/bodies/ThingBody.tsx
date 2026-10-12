import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { Thing } from "@/model/types";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { Chips, Row, Stack, Text } from "./parts";
import styles from "./Bodies.module.css";

function ThingBody({ entry }: BodyProps) {
  const m = useModel();
  const t = entry.item as Thing;
  return (
    <Stack>
      <Text>{t.description}</Text>
      <Row label="Template">{t.templateRef ? (m.byId(t.templateRef) ? <NodeChip id={t.templateRef} size="sm" /> : <code>{t.templateRef}</code>) : <span className={styles.muted}>none</span>}</Row>
      <Row label="Sections"><Chips ids={t.sections} /></Row>
      <Row label="Purposes" show={t.purposeRefs.length > 0}><Chips ids={t.purposeRefs} /></Row>
      <Row label="Artifacts">
        {t.artifacts.length ? (
          <ul className={styles.plain}>
            {t.artifacts.map((a) => (
              <li key={a.artifact}>
                <code>{a.artifact}</code> <span className={styles.muted}>{a.type}{a.repo ? ` · ${a.repo}` : ""}{a.commit ? ` @ ${a.commit.slice(0, 7)}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <span className={styles.muted}>none</span>}
      </Row>
    </Stack>
  );
}
registerBody("thing", ThingBody);
