import { useEffect, useState, type ReactNode } from "react";
import { SurfaceField, type SurfacePresetName } from "@artyfact/effects";
import styles from "./EmptyState.module.css";

/** Empty-state light settles after one short arrival; all meaning remains in the text. */
function QuietSurface({ preset }: { preset: SurfacePresetName }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSettled(true), 2600); return () => clearTimeout(timer); }, []);
  return <SurfaceField preset={preset} level={.2} activity={.15} density={.2} paused={settled} />;
}

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  live?: boolean;
  /** Card-local light behind the content (`true` = `dusk`). Decorative; settles after arrival. */
  surface?: boolean | SurfacePresetName;
}

/**
 * Plain statement of absence plus an optional next action. Never coloured as success.
 * `live` makes it a polite status region (only for states that appear after user action).
 */
export function EmptyState({ title, children, action, live = false, surface }: EmptyStateProps) {
  const preset: SurfacePresetName | null = surface === true ? "dusk" : surface || null;
  return (
    <div className={styles.empty} data-surface={preset ? "" : undefined} {...(live && { role: "status" })}>
      {preset && <QuietSurface preset={preset} />}
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.body}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}
