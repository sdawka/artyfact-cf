import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useState, type ReactNode } from "react";
import { useEffectsPreference } from "@/effects/effectsPreference";
import styles from "./OutsideMenu.module.css";

export interface OutsideItem { id: string; name: string; kind: string; onSelect(): void }
const CAP = 6;

/** Deduped by id, grouped by kind, each group capped with a "+n more" row; the list scrolls inside its own bounds. */
export function OutsideMenu({ label, items, trigger }: { label: string; items: readonly OutsideItem[]; trigger: ReactNode }) {
  const { enabled } = useEffectsPreference();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groups = new Map<string, OutsideItem[]>();
  for (const item of new Map(items.map((i) => [i.id, i])).values()) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  return <MenuPrimitive.Root onOpenChange={(next) => { if (!next) setOpen(new Set()); }}>
    <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content aria-label={label} align="start" sideOffset={8} collisionPadding={12} data-effects={enabled ? "on" : "off"} className={styles.menu}>
        <div className={styles.title}>Show on map</div>
        {[...groups].map(([kind, list]) => {
          const shown = open.has(kind) ? list : list.slice(0, CAP);
          return <MenuPrimitive.Group key={kind}>
            <MenuPrimitive.Label className={styles.group}>{kind}</MenuPrimitive.Label>
            {shown.map((item) => <MenuPrimitive.Item key={item.id} className={styles.item} aria-label={`Show ${item.name} on map`} onSelect={item.onSelect}>
              <span className={styles.name}>{item.name}</span><span className={styles.meta}>{item.kind} · {item.id}</span>
            </MenuPrimitive.Item>)}
            {list.length > shown.length && <MenuPrimitive.Item className={styles.more} onSelect={(event) => { event.preventDefault(); setOpen(new Set([...open, kind])); }}>
              +{list.length - shown.length} more
            </MenuPrimitive.Item>}
          </MenuPrimitive.Group>;
        })}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  </MenuPrimitive.Root>;
}
