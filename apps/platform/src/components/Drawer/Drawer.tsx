import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import styles from "./Drawer.module.css";

export interface DrawerProps {
  open: boolean;
  /** Accessible name of the drawer region. */
  label: string;
  width: number;
  onWidthChange?(width: number): void;
  minWidth?: number;
  maxWidth?: number;
  children: ReactNode;
}

/**
 * Right-hand panel with a drag/keyboard resize handle on its left edge. At phone width it
 * becomes a bottom sheet (CSS only). Renders nothing when closed.
 */
export function Drawer({ open, label, width, onWidthChange, minWidth = 280, maxWidth = 720, children }: DrawerProps) {
  const start = useRef<{ x: number; w: number } | null>(null);
  if (!open) return null;
  const clamp = (w: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(w)));
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, w: width };
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
      onWidthChange?.(clamp(width + d));
    }
  };
  return (
    <aside className={styles.drawer} aria-label={label} style={{ width }}>
      {onWidthChange && (
        <div
          className={styles.handle}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
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
