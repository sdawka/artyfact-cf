import { useEffect, useState, type ReactNode } from "react";
import { SurfaceField, type SurfacePresetName } from "@artyfact/effects";
import { Button } from "../ui/Controls";
import styles from "./EmptyState.module.css";

/** Empty-state light settles after one short arrival; all meaning remains in the text. */
function QuietSurface({ preset }: { preset: SurfacePresetName }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSettled(true), 2600); return () => clearTimeout(timer); }, []);
  return <SurfaceField preset={preset} level={.2} activity={.15} density={.2} paused={settled} />;
}

export interface EmptyStateProps {
  /** Empty: "{Thing} yet." Error: what failed ("Could not load builds."). */
  title: string;
  /** Empty: how it gets filled. Error: the cause if known ("The API returned 503."). */
  children?: ReactNode;
  /** The one next step. For `kind="error"` without an action, `onRetry` renders "Try again". */
  action?: ReactNode;
  /** `empty` (default) or `error` (`role="alert"`, title in the danger colour). */
  kind?: "empty" | "error";
  onRetry?: () => void;
  /** Render the title as a heading of this level (default: a paragraph). */
  headingLevel?: 2 | 3 | 4;
  live?: boolean;
  /** Card-local light behind the content (`true` = `dusk`). Page-level empties only (one SurfaceField per view). */
  surface?: boolean | SurfacePresetName;
}

/**
 * Plain statement of absence (or of a failure) plus one next action. Never coloured as success; never "— unknown."
 * `live` makes an empty state a polite status region (only for states that appear after user action).
 */
export function EmptyState({ title, children, action, kind = "empty", onRetry, headingLevel, live = false, surface }: EmptyStateProps) {
  const preset: SurfacePresetName | null = surface === true ? "dusk" : surface || null;
  const T = headingLevel ? (`h${headingLevel}` as const) : "p";
  const next = action ?? (kind === "error" && onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined);
  const role = kind === "error" ? { role: "alert" } : live ? { role: "status" } : {};
  return (
    <div className={styles.empty} data-kind={kind} data-surface={preset ? "" : undefined} {...role}>
      {preset && <QuietSurface preset={preset} />}
      <div className={styles.text}>
        <T className={styles.title}>{title}</T>
        {children && <div className={styles.body}>{children}</div>}
        {next && <div className={styles.action}>{next}</div>}
      </div>
    </div>
  );
}
