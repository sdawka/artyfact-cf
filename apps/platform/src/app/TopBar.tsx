import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { resetClientMode } from "@/api/client";
import { useEvaluations } from "@/api/queries";
import { useEffectsPreference } from "@/effects/effectsPreference";
import { FAKE_PROVIDER_TITLE, isFakeProvider } from "@/model/provider";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { LayerSwitch } from "./LayerSwitch";
import { PhaseBadge } from "./PhaseBadge";
import { StatePill } from "./StatePill";
import { SystemRevisionSelector } from "./SystemRevisionSelector";
import styles from "./TopBar.module.css";

export function TopBar({ onOpenPalette }: { onOpenPalette(): void }) {
  const { bundle } = useModel();
  const href = useKeepParams();
  const qc = useQueryClient();
  const evaluations = useEvaluations();
  const effects = useEffectsPreference();
  const fakeS1 = (evaluations.data ?? []).some((e) => isFakeProvider(e.provenance?.provider));
  const retry = () => {
    resetClientMode();
    void qc.invalidateQueries();
  };
  return (
    <header className={styles.bar}>
      <Link to={href("overview")} className={`wordmark ${styles.wordmark}`}>artyfact</Link>
      <SystemRevisionSelector />
      <PhaseBadge phase={bundle.model.system.phase} />
      {bundle.source === "fixture" && (
        <StatePill state="fixture" title="The platform API is unavailable or has no Systems; showing the bundled Keep in Touch fixture.">
          fixture data
        </StatePill>
      )}
      {bundle.source === "fixture" && (
        <button type="button" className={`u-brackets ${styles.retry}`} onClick={retry}>
          Retry API
        </button>
      )}
      {fakeS1 && <StatePill state="fake" title={FAKE_PROVIDER_TITLE}>System One: fake provider</StatePill>}
      <div className={styles.spacer} />
      <LayerSwitch />
      <button
        type="button"
        className={`u-brackets ${styles.effects}`}
        aria-pressed={effects.enabled}
        onClick={effects.toggle}
        title={effects.enabled ? "Turn ambient effects off" : "Turn ambient effects on"}
      >
        <span aria-hidden="true">{effects.enabled ? "✦" : "✧"}</span> Effects
      </button>
      <button type="button" className={`u-brackets ${styles.search}`} onClick={onOpenPalette} aria-keyshortcuts="Meta+K Control+K">
        Go to… <kbd className={styles.kbd}>⌘K</kbd>
      </button>
    </header>
  );
}
