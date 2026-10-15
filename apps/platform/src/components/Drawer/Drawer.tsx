import { SHELL_RAIL_WIDTH, useCompactLayout, useViewportWidth } from "@/app/useCompactLayout";
import { Sheet } from "@/components/ui";
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import styles from "./Drawer.module.css";

export interface DrawerProps {
  open: boolean;
  /** Accessible name of the drawer region. */
  label: string;
  /** The bottom sheet's heading (the object's name); defaults to `label`. The drawer itself carries its own heading. */
  title?: string;
  /** Accessible name of the bottom sheet's one close control. */
  closeLabel?: string;
  width: number;
  onWidthChange?(width: number): void;
  minWidth?: number;
  maxWidth?: number;
  onClose?(): void;
  children: ReactNode;
}

/**
 * Right-hand panel with a drag/keyboard resize handle on its left edge. Below the shell breakpoint it
 * becomes a modal bottom sheet whose heading is `title`. Renders nothing when closed.
 */
export function Drawer({ open, label, title, closeLabel, width, onWidthChange, minWidth = 280, maxWidth = 720, onClose, children }: DrawerProps) {
  const compact = useCompactLayout();
  const viewportWidth = useViewportWidth();
  const availableMax = Math.max(minWidth, Math.min(maxWidth, viewportWidth - SHELL_RAIL_WIDTH - 400));
  const effectiveWidth = Math.min(width, availableMax);
  const start = useRef<{ x: number; w: number } | null>(null);
  if (!open) return null;
  const clamp = (w: number) => Math.min(availableMax, Math.max(minWidth, Math.round(w)));
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, w: effectiveWidth };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) onWidthChange?.(clamp(start.current.w + start.current.x - e.clientX));
  };
  const onUp = () => {
    start.current = null;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (d) {
      e.preventDefault();
      onWidthChange?.(clamp(effectiveWidth + d));
    }
  };
  if (compact) return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose?.(); }} title={title ?? label} closeLabel={closeLabel} side="bottom" className={styles.sheet} onEscapeKeyDown={(event) => event.stopPropagation()}
    onCloseAutoFocus={(event) => event.preventDefault()}
    onOpenAutoFocus={(event) => { event.preventDefault(); (event.target as HTMLElement).querySelector<HTMLElement>("[data-inspector-title]")?.focus(); }}>
    <aside aria-label={label} className={styles.sheetAside} tabIndex={-1} data-inspector-title><div className={styles.body}>{children}</div></aside>
  </Sheet>;
  return (
    <aside className={styles.drawer} aria-label={label} style={{ width: effectiveWidth }}>
      {onWidthChange && (
        <div
          className={styles.handle}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          aria-valuenow={effectiveWidth}
          aria-valuemin={minWidth}
          aria-valuemax={availableMax}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onKeyDown={onKey}
        />
      )}
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
