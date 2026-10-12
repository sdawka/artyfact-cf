import { NodeChip } from "@/components/NodeChip/NodeChip";
import styles from "./Breadcrumbs.module.css";

/** Containment path as clickable chips, e.g. `useModel().path(id).map((e) => e.id)`. */
export function Breadcrumbs({ ids, label = "Breadcrumb" }: { ids: string[]; label?: string }) {
  if (!ids.length) return null;
  return (
    <nav aria-label={label}>
      <ol className={styles.list}>
        {ids.map((id, i) => (
          <li key={id} className={styles.item}>
            {i > 0 && <span className={styles.sep} aria-hidden="true">/</span>}
            <NodeChip id={id} size="sm" {...(i === ids.length - 1 && { interactive: false })} />
          </li>
        ))}
      </ol>
    </nav>
  );
}
