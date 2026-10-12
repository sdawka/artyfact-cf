import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange(id: T): void;
  /** Accessible name of the tab list. */
  label: string;
  /** Rendered as the panel of the selected tab. */
  children?: ReactNode;
}

/** Tapered-segment tabs (`.u-segments`) with arrow-key navigation. */
export function Tabs<T extends string>({ tabs, value, onChange, label, children }: TabsProps<T>) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((t) => !t.disabled);
  const onKey = (e: KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === value);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = enabled[(i + step + enabled.length) % enabled.length]!;
    onChange(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div className={styles.tabs}>
      <div ref={list} className={`u-segments ${styles.list}`} role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-${t.id}`}
            data-tab={t.id}
            aria-selected={t.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={t.id === value ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${value}`} className={styles.panel}>
          {children}
        </div>
      )}
    </div>
  );
}
