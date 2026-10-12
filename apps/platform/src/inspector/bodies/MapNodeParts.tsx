/**
 * Shared pieces for the Map slice's What-tab bodies (Screen, Component, Affordance). Registers nothing.
 */
import type { ReactNode } from "react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import type { OntologyNode } from "@/model/types";
import { useModel } from "@/model/useModel";
import styles from "./MapNodeBody.module.css";

export function NodeBodyFrame({ entry, children }: { entry: IndexEntry; children: ReactNode }) {
  const node = entry.item as OntologyNode;
  return (
    <div className={styles.body}>
      {node.description && <p className={styles.description}>{node.description}</p>}
      <dl className={styles.fields}>{children}</dl>
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

/** One field; missing values read "unknown". Strings that are model ids render as chips. */
export function Field({ label, value, code }: { label: string; value: string | undefined; code?: boolean }) {
  const model = useModel();
  const body =
    value === undefined || value === "" ? (
      <span className={styles.unknown}>unknown</span>
    ) : model.byId(value) ? (
      <NodeChip id={value} size="sm" />
    ) : code ? (
      <code>{value}</code>
    ) : (
      value
    );
  return (
    <div className={styles.row}>
      <dt className={styles.key}>{label}</dt>
      <dd className={styles.value}>{body}</dd>
    </div>
  );
}

/** A list field; an empty list reads "none". */
export function ListField({ label, items, inline }: { label: string; items: readonly string[]; inline?: boolean }) {
  return (
    <div className={styles.row}>
      <dt className={styles.key}>{label}</dt>
      <dd className={styles.value}>
        {items.length === 0 ? (
          <span className={styles.unknown}>none</span>
        ) : (
          <ul className={inline ? styles.inline : styles.list}>
            {items.map((x, i) => (
              <li key={`${i}-${x}`}>{x}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

/** Containment children as chips. */
export function Inside({ id }: { id: string }) {
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
