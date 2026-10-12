import type { BodyProps } from "./registry";
import { registerBody } from "./registry";
import type { OntologyNode } from "@/model/types";
import { Chips, Lines, Row, Stack, Text, useLinked } from "./parts";
import styles from "./Bodies.module.css";

function EntityBody({ entry }: BodyProps) {
  const n = entry.item as OntologyNode;
  const storedIn = useLinked(entry, "storedIn", "out");
  const governedBy = useLinked(entry, "governs", "in");
  return (
    <Stack>
      <Text>{n.description}</Text>
      <Row label="Fields">
        {n.fields.length ? (
          <table className={styles.table}>
            <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Required</th></tr></thead>
            <tbody>
              {n.fields.map((f) => (
                <tr key={f.name}><td><code>{f.name}</code></td><td><code>{f.type}</code></td><td>{f.optional ? "optional" : "required"}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <span className={styles.muted}>none declared</span>}
      </Row>
      <Row label="Invariants"><Lines items={n.invariants} /></Row>
      <Row label="Cardinality" show={!!n.cardinality}>{n.cardinality}</Row>
      <Row label="Stored in"><Chips ids={storedIn} /></Row>
      <Row label="Governed by"><Chips ids={governedBy} /></Row>
    </Stack>
  );
}
registerBody("entity", EntityBody);
