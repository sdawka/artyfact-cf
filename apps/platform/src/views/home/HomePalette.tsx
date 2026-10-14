import { useEffectsPreference } from "@/effects/effectsPreference";
import type { RefObject } from "react";
import { Dialog } from "@/components/ui";
import { Command } from "cmdk";
import { useNavigate } from "react-router";
import type { PartSummary, SystemSummary } from "../../../shared/api";
import styles from "@/app/CommandPalette.module.css";

/** ⌘K on Home: go to a System or a shared Part. Home has no System model, so this is its own small index. */
export function HomePalette({ open, onOpenChange, systems, parts, returnFocus }: {
  returnFocus?: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpenChange(open: boolean): void;
  systems: readonly SystemSummary[];
  parts: readonly PartSummary[];
}) {
  const navigate = useNavigate();
  const effects = useEffectsPreference();
  const go = (to: string) => {
    onOpenChange(false);
    void navigate(to);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Go to a System or Part" className={styles.homeContent}
      onOpenAutoFocus={(event) => { event.preventDefault(); (event.target as HTMLElement).querySelector<HTMLElement>('[role="combobox"]')?.focus(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); const target = returnFocus?.current; (target?.isConnected ? target : document.getElementById("main"))?.focus(); }}>
      <Command vimBindings={false} label="Go to a System or Part" className={styles.dialog} data-effects={effects.enabled ? "on" : "off"}>
      <Command.Input className={styles.input} placeholder="Go to a System or Part…" />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No matches.</Command.Empty>
        <Command.Group heading="Systems" className={styles.group}>
          {systems.map((s) => (
            <Command.Item key={s.systemId} value={`system ${s.systemId}`} keywords={[s.title]} className={styles.item} onSelect={() => go(`/s/${encodeURIComponent(s.systemId)}`)}>
              <span className={styles.name}>{s.title || s.systemId}</span>
              <code className={styles.id}>{s.systemId}</code>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Reusable Parts" className={styles.group}>
          {parts.filter((p) => p.scope.kind === "shared").map((p) => (
            <Command.Item
              key={`${p.partId}@${p.version}`}
              value={`part ${p.partId}@${p.version}`}
              keywords={[p.name || p.partId]}
              className={styles.item}
              onSelect={() => go(`/parts/${encodeURIComponent(p.partId)}/${encodeURIComponent(p.version)}`)}
            >
              <span className={styles.name}>{p.name || p.partId}</span>
              <code className={styles.id}>{p.partId}@{p.version}</code>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
      </Command>
    </Dialog>
  );
}
