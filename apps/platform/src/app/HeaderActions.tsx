import { useRef, useState, type RefObject } from "react";
import { DotsHorizontalIcon, MagicWandIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Button, Menu } from "@/components/ui";
import { useCompactLayout } from "./useCompactLayout";
import { AdminTokenControl } from "./AdminTokenControl";
import styles from "./TopBar.module.css";

export function HeaderActions({ onOpenPalette, retry, effects, paletteTriggerRef }: {
  paletteTriggerRef?: RefObject<HTMLButtonElement | null>; onOpenPalette(): void; retry?: () => void; effects?: { enabled: boolean; toggle(): void };
}) {
  const compact = useCompactLayout();
  const [adminOpen, setAdminOpen] = useState(false);
  const pendingAdmin = useRef(false);
  const more = useRef<HTMLButtonElement>(null);
  const utilities = [
    { id: "admin", label: "Admin token", onSelect: () => { pendingAdmin.current = true; } },
    ...(retry ? [{ id: "retry", label: "Retry API", onSelect: retry }] : []),
    ...(effects ? [{ id: "effects", label: "Effects", checked: effects.enabled, onSelect: effects.toggle, icon: <MagicWandIcon /> }] : []),
  ];
  return <>
    <AdminTokenControl open={adminOpen} onOpenChange={setAdminOpen} triggerHidden={compact} returnFocus={compact ? more : undefined} />
    {compact ? <Menu onCloseAutoFocus={(event) => { if (pendingAdmin.current) { event.preventDefault(); pendingAdmin.current = false; setAdminOpen(true); } }} label="More actions" trigger={<Button ref={more} aria-label="More"><DotsHorizontalIcon /> More</Button>} items={utilities} /> : <>
      {retry && <Button className={styles.retry} onClick={retry}>Retry API</Button>}
      {effects && <Button aria-pressed={effects.enabled} onClick={effects.toggle} title={effects.enabled ? "Turn ambient effects off" : "Turn ambient effects on"}><MagicWandIcon /> Effects</Button>}
    </>}
    <Button ref={paletteTriggerRef} onClick={onOpenPalette} aria-keyshortcuts="Meta+K Control+K" aria-label="Go to…" className={styles.search}>
      <MagnifyingGlassIcon aria-hidden="true" /><span className={styles.searchLabel}>Go to…</span><kbd className={styles.kbd}>⌘K</kbd>
    </Button>
  </>;
}
