import { useEffect, useState, type ReactNode } from "react";
import { Orb, type OrbPresetName } from "@artyfact/effects";
import styles from "./EmptyState.module.css";

/** Small, dim orb that unfolds once (the intro) and then holds still: a moment of charm, not a running animation. */
function QuietOrb({ preset }: { preset: OrbPresetName }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 2600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={styles.orb} aria-hidden="true">
      <Orb preset={preset} size={0.9} particleCount={4000} interactive={false} paused={settled} sparks={0.1} flares={0.3} glow={0.6} />
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  live?: boolean;
  /** A small, dim, intro-only orb beside the title (`true` = `dusk`). Decorative; at most one per screen region. */
  orb?: boolean | OrbPresetName;
}

/**
 * Plain statement of absence plus an optional next action. Never coloured as success.
 * `live` makes it a polite status region (only for states that appear after user action).
 */
export function EmptyState({ title, children, action, live = false, orb }: EmptyStateProps) {
  const preset: OrbPresetName | null = orb === true ? "dusk" : orb || null;
  return (
    <div className={styles.empty} data-orb={preset ? "" : undefined} {...(live && { role: "status" })}>
      {preset && <QuietOrb preset={preset} />}
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.body}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}
