import { KeyValue } from "@/components/KeyValue/KeyValue";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import { fieldValue, useKindView } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import styles from "./NodeBody.module.css";

/**
 * What body for any Genome node without a registered body: the fields its kind's view hints list, in hint order (the
 * header already shows the title and summary fields), then the containment children.
 */
export function NodeBody({ entry }: { entry: IndexEntry }) {
  const view = useKindView(entry.kind);
  const node = (entry.item ?? {}) as { provisional?: boolean; fromTemplate?: string };
  const fields = view.fields.filter((f) => f !== view.title && f !== view.summary);
  return (
    <div className={styles.body} data-node-body={entry.kind}>
      <KeyValue data={fields.map((f): [string, unknown] => [f, fieldValue(entry.item, f)])} />
      {node.provisional && <p className={styles.note}>Provisional: not yet confirmed in the Genome.</p>}
      {node.fromTemplate && (
        <p className={styles.note}>
          From template <code>{node.fromTemplate}</code>
        </p>
      )}
      <Inside id={entry.id} />
    </div>
  );
}

/** Containment children as chips. */
function Inside({ id }: { id: string }) {
  const kids = useModel().children(id);
  if (!kids.length) return null;
  return (
    <section className={styles.inside} aria-label="Inside">
      <h3 className={styles.heading}>Inside · {kids.length}</h3>
      <ul className={styles.chips}>
        {kids.map((k) => (
          <li key={k.id}>
            <NodeChip id={k.id} size="sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}
