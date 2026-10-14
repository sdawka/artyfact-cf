import { useQueryClient } from "@tanstack/react-query";
import { resetClientMode } from "@/api/client";
import { useEvaluations, usePlatform } from "@/api/queries";
import { useEffectsPreference } from "@/effects/effectsPreference";
import { FAKE_PROVIDER_TITLE, isFakeProvider } from "@/model/provider";
import { useModel } from "@/model/useModel";
import { AppHeader } from "./AppHeader";
import { HeaderActions } from "./HeaderActions";
import { PhaseBadge } from "./PhaseBadge";
import { FIXTURE_TITLE, HostedDemoPill, StatePill } from "./StatePill";
import { SystemRevisionSelector } from "./SystemRevisionSelector";
import type { ReactNode } from "react";

export function TopBar({ onOpenPalette, navigation }: { onOpenPalette(): void; navigation?: ReactNode }) {
  const { bundle } = useModel();
  const qc = useQueryClient();
  const evaluations = useEvaluations();
  const effects = useEffectsPreference();
  const platform = usePlatform();
  const fakeS1 = !platform.data?.hostedDemo && (evaluations.data ?? []).some((e) => isFakeProvider(e.provenance?.provider));
  const retry = () => { resetClientMode(); void qc.invalidateQueries(); };
  return <AppHeader navigation={navigation} context={<SystemRevisionSelector />} status={<>
    <PhaseBadge phase={bundle.model.system.phase} />
    {bundle.source === "fixture" && <StatePill state="fixture" title={FIXTURE_TITLE}>fixture data</StatePill>}
    <HostedDemoPill notice={platform.data?.notice} />
    {fakeS1 && <StatePill state="fake" title={FAKE_PROVIDER_TITLE}>System One: fake provider</StatePill>}
  </>} actions={<HeaderActions onOpenPalette={onOpenPalette} retry={bundle.source === "fixture" ? retry : undefined} effects={effects} />} />;
}
