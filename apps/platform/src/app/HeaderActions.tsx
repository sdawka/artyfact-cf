import { useRef, useState, type RefObject } from "react";
import { DotsHorizontalIcon, MagicWandIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Button, Menu, type MenuItem } from "@/components/ui";
import { Kbd } from "@/components/Kbd/Kbd";
import { SHELL_COMPACT_MAX, useViewportWidth } from "./useCompactLayout";
import { AdminTokenControl } from "./AdminTokenControl";
import styles from "./TopBar.module.css";

/** Below this Effects and Retry API move into More and the Go to shortcut hint hides. */
export const NARROW_MAX = 1280;

export function HeaderActions({ onOpenPalette, retry, effects, paletteTriggerRef, info = [] }: {
  paletteTriggerRef?: RefObject<HTMLButtonElement | null>; onOpenPalette(): void; retry?: () => void; effects?: { enabled: boolean; toggle(): void };
  /** Read-only facts that live in More on compact screens (Phase, provider). */
  info?: string[];
}) {
  const width = useViewportWidth();
  const compact = width < SHELL_COMPACT_MAX;
  const narrow = width < NARROW_MAX;
  const [adminOpen, setAdminOpen] = useState(false);
  const pendingAdmin = useRef(false);
  const more = useRef<HTMLButtonElement>(null);
  const utilities: MenuItem[] = [
    ...(compact ? [{ id: "admin", label: "Admin token…", onSelect: () => { pendingAdmin.current = true; }, group: "actions" }] : []),
    ...(narrow && retry ? [{ id: "retry", label: "Retry API", onSelect: retry, group: "actions" }] : []),
    ...(narrow && effects ? [{ id: "effects", label: "Effects", checked: effects.enabled, onSelect: effects.toggle, icon: <MagicWandIcon />, group: "actions" }] : []),
    ...(compact ? info.map((label, i) => ({ id: `info-${i}`, label, disabled: true, group: "info" })) : []),
  ];
  return <>
    <AdminTokenControl open={adminOpen} onOpenChange={setAdminOpen} compact={compact} returnFocus={compact ? more : undefined} />
    {!narrow && effects && <Button aria-pressed={effects.enabled} onClick={effects.toggle} title={effects.enabled ? "Turn ambient effects off" : "Turn ambient effects on"}><MagicWandIcon aria-hidden="true" /> Effects: {effects.enabled ? "on" : "off"}</Button>}
    <Button ref={paletteTriggerRef} onClick={onOpenPalette} aria-keyshortcuts="Meta+K Control+K" aria-label="Go to…" className={styles.search}>
      <MagnifyingGlassIcon aria-hidden="true" /><span className={styles.searchLabel}>Go to…</span><span className={styles.kbd}><Kbd keys={["Mod", "K"]} /></span>
    </Button>
    {utilities.length > 0 && <Menu onCloseAutoFocus={(event) => { if (pendingAdmin.current) { event.preventDefault(); pendingAdmin.current = false; setAdminOpen(true); } }} label="More actions" trigger={<Button ref={more} aria-label="More" className={styles.more}><DotsHorizontalIcon aria-hidden="true" /><span className={styles.moreLabel}> More</span></Button>} items={utilities} />}
  </>;
}
