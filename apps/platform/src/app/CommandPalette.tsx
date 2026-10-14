import { Command } from "cmdk";
import { useEffectsPreference } from "@/effects/effectsPreference";
import { bestViewFor, kindColour, titleOf, useKindViews } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import styles from "./CommandPalette.module.css";

/** ⌘K: search every indexed object by name or id; Enter focuses it in the view that suits its kind. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { index } = useModel();
  const { setFocus } = useSelection();
  const atlas = useAtlasNavigation();
  const { view } = useSystemRoute();
  const views = useKindViews();
  const effects = useEffectsPreference();
  return (
    <Command.Dialog
      data-effects={effects.enabled ? "on" : "off"}
      open={open}
      onOpenChange={onOpenChange}
      label="Go to node"
      className={styles.dialog}
      overlayClassName={`${styles.overlay} ${!effects.enabled ? styles.motionOff : ""}`}
      contentClassName={`${styles.content} ${!effects.enabled ? styles.motionOff : ""}`}
    >
      <Command.Input className={styles.input} placeholder="Go to a node, criterion, journey…" />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No matches.</Command.Empty>
        {index.entries.map((e) => {
          const info = views.of(e.kind);
          const name = titleOf(e, info);
          return (
            <Command.Item
              key={e.id}
              value={e.id}
              keywords={[name, info.label]}
              className={styles.item}
              onSelect={() => {
                onOpenChange(false);
                if (bestViewFor(e.type) === "map" || (view === "map" && ["system", "external"].includes(e.type))) atlas.locate(e.id);
                else setFocus(e.id, { view: bestViewFor(e.type) });
              }}
            >
              <span className={styles.glyph} style={kindColour(info)} aria-hidden="true">{info.glyph}</span>
              <span className={styles.name}>{name}</span>
              <code className={styles.id}>{e.id}</code>
            </Command.Item>
          );
        })}
        <Command.Group heading="Settings" className={styles.group}>
          <Command.Item
            value="settings.effects"
            keywords={["effects", "ambient", "animation", "motion", "glow"]}
            className={styles.item}
            onSelect={() => {
              onOpenChange(false);
              effects.toggle();
            }}
          >
            <span className={styles.glyph} aria-hidden="true">✦</span>
            <span className={styles.name}>{effects.enabled ? "Turn effects off" : "Turn effects on"}</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
