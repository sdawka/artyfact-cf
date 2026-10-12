import { Command } from "cmdk";
import { bestViewFor, kindInfo } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useSelection } from "@/model/useSelection";
import styles from "./CommandPalette.module.css";

/** ⌘K: search every indexed object by name or id; Enter focuses it in the view that suits its kind. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { index } = useModel();
  const { setFocus } = useSelection();
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Go to node"
      className={styles.dialog}
      overlayClassName={styles.overlay}
      contentClassName={styles.content}
    >
      <Command.Input className={styles.input} placeholder="Go to a node, criterion, journey…" />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No matches.</Command.Empty>
        {index.entries.map((e) => {
          const info = kindInfo(e.kind);
          return (
            <Command.Item
              key={e.id}
              value={e.id}
              keywords={[e.name, info.label]}
              className={styles.item}
              onSelect={() => {
                onOpenChange(false);
                setFocus(e.id, { view: bestViewFor(e.kind) });
              }}
            >
              <span className={styles.glyph} aria-hidden="true">{info.glyph}</span>
              <span className={styles.name}>{e.name}</span>
              <code className={styles.id}>{e.id}</code>
            </Command.Item>
          );
        })}
      </Command.List>
    </Command.Dialog>
  );
}
