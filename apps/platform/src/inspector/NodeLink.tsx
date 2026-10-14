import { titleOf, useKindViews } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useSelection } from "@/model/useSelection";
import styles from "./Inspector.module.css";

/** A node's name as a text link that focuses it (inline reference inside rows and meta lines). */
export function NodeLink({ id }: { id: string }) {
  const entry = useModel().byId(id);
  const kinds = useKindViews();
  const { setFocus } = useSelection();
  const view = kinds.of(entry?.kind ?? "unknown");
  return (
    <button type="button" className={styles.linkButton} title={`${view.label}: ${id}`} onClick={() => setFocus(id)}>
      {entry ? titleOf(entry, view) : id}
    </button>
  );
}
