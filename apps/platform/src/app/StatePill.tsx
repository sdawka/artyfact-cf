import type { ReactNode } from "react";
import styles from "./StatePill.module.css";

/** Tooltip on the "fixture data" pill (TopBar and Home header). */
export const FIXTURE_TITLE = "The platform API is unreachable; showing the bundled Peopling fixture.";

/** Label of the hosted demo pill (TopBar and Home header); the notice from `/api/platform` is its tooltip. */
export function HostedDemoPill({ notice }: { notice?: string }) {
  return notice ? <StatePill state="fake" title={notice}>Hosted demo: judgments are simulated</StatePill> : null;
}

export type RevisionState = "canonical" | "candidate" | "deployed" | "fixture" | "fake";

/** Small bordered tag naming what the user is looking at. Square-ish corners; never a pill shape or a fill. */
export function StatePill({ state, children, title }: { state: RevisionState; children?: ReactNode; title?: string }) {
  return (
    <span className={styles.pill} data-state={state} title={title}>
      {children ?? state}
    </span>
  );
}
