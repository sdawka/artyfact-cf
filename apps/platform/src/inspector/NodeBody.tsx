import { KeyValue } from "@/components/KeyValue/KeyValue";
import { GenericBody } from "./bodies/GenericBody";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import { fieldValue, useKindView } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import styles from "./NodeBody.module.css";

/** Keys every node carries or another tab shows (Why: source and refines; Dependencies: links). */
const STRUCTURAL = new Set(["id", "kind", "name", "parent", "links", "revision", "source", "refines", "provisional", "fromTemplate", "template", "owningThing"]);

/** The node's own field names: its properties, or a v2 node's `fields` map. */
function ownFields(item: Record<string, unknown>): string[] {
  const f = item.fields;
  const map = f && typeof f === "object" && !Array.isArray(f) ? Object.keys(f) : [];
  return [...Object.keys(item).filter((k) => !STRUCTURAL.has(k) && !(map.length && k === "fields")), ...map];
}

/**
 * What body for any Genome node without a registered body: the fields its kind's view hints list, in hint order (the
 * header already shows the title and summary fields), then any other own fields, then the containment children. A kind
 * no template declares (no hinted fields) gets the raw key/value dump.
 */
export function NodeBody({ entry }: { entry: IndexEntry }) {
  const view = useKindView(entry.kind);
  if (!view.fields.length) return <GenericBody entry={entry} />;
  const node = (entry.item ?? {}) as Record<string, unknown> & { provisional?: boolean; fromTemplate?: string };
  const shown = new Set([view.title, view.summary]);
  const fields = [...new Set([...view.fields, ...ownFields(node)])].filter((f) => !shown.has(f));
  return (
    <div className={styles.body} data-node-body={entry.kind}>
      <div data-node-fields>
        <KeyValue data={fields.map((f): [string, unknown] => [f, fieldValue(entry.item, f)])} />
      </div>
      <Conformance id={entry.id} />
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

/** Criteria on this node, and for a container the verdict counts over its subtree (only pass is green, nothing ran is not-run). */
function Conformance({ id }: { id: string }) {
  const m = useModel();
  const criteria = m.criteriaFor(id);
  const container = m.children(id).length > 0;
  if (!criteria.length && !container) return null;
  const r = m.rollup(id);
  return (
    <dl className={styles.facts}>
      {criteria.length > 0 && (
        <div>
          <dt>Criteria</dt>
          <dd>
            <ul className={styles.chips}>
              {criteria.map((c) => <li key={c.id}><NodeChip id={c.id} size="sm" /></li>)}
            </ul>
          </dd>
        </div>
      )}
      {container && (
        <div>
          <dt>Conformance inside</dt>
          <dd>{r.pass} pass · {r.fail} fail · {r.unknown + r.stale} unknown · {r.notRun} not run</dd>
        </div>
      )}
    </dl>
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
