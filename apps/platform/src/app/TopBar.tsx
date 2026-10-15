import { useEvaluations, usePlatform } from "@/api/queries";
import { useEffectsPreference } from "@/effects/effectsPreference";
import { FAKE_PROVIDER_TITLE, isFakeProvider } from "@/model/provider";
import { useModel } from "@/model/useModel";
import { AppHeader } from "./AppHeader";
import { CatModeBadge } from "./catMode";
import { HeaderActions, NARROW_MAX } from "./HeaderActions";
import { PhaseBadge } from "./PhaseBadge";
import { FixtureCluster, HostedDemoPill, StatePill } from "./StatePill";
import { SystemRevisionSelector } from "./SystemRevisionSelector";
import { useRetryApi } from "./useRetryApi";
import { SHELL_COMPACT_MAX, useViewportWidth } from "./useCompactLayout";
import type { ReactNode } from "react";

export function TopBar({ onOpenPalette, navigation }: { onOpenPalette(): void; navigation?: ReactNode }) {
  const { bundle } = useModel();
  const evaluations = useEvaluations();
  const effects = useEffectsPreference();
  const platform = usePlatform();
  const width = useViewportWidth();
  const fakeS1 = !platform.data?.hostedDemo && (evaluations.data ?? []).some((e) => isFakeProvider(e.provenance?.provider));
  const retry = useRetryApi();
  const fixture = bundle.source === "fixture";
  const phase = bundle.model.system.phase;
  const compact = width < SHELL_COMPACT_MAX;
  // Compact screens keep only the fixture cluster in view; Phase and provider are read-only items in More.
  const info = [`Phase: ${phase ?? "unknown"}`, ...(fakeS1 ? ["System One: fake provider"] : [])];
  return <AppHeader navigation={navigation} badge={platform.data?.catMode ? <CatModeBadge /> : undefined} context={<SystemRevisionSelector />} status={!compact || fixture || platform.data?.notice ? <>
    {!compact && <PhaseBadge phase={phase} />}
    {fixture && <FixtureCluster retry={width >= NARROW_MAX ? retry : undefined} />}
    <HostedDemoPill notice={platform.data?.notice} />
    {fakeS1 && !compact && <StatePill state="fake" title={FAKE_PROVIDER_TITLE}>fake provider</StatePill>}
  </> : undefined} actions={<HeaderActions onOpenPalette={onOpenPalette} retry={fixture ? retry : undefined} effects={effects} info={info} />} />;
}
