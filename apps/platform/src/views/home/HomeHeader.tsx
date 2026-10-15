import { EffectsPreferenceProvider, useEffectsPreference } from "@/effects/effectsPreference";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/app/AppHeader";
import { CatModeBadge } from "@/app/catMode";
import { handlePaletteShortcut } from "@/app/paletteShortcut";
import { HeaderActions } from "@/app/HeaderActions";
import { useRetryApi } from "@/app/useRetryApi";
import { useClientMode, useParts, usePlatform, useSystems } from "@/api/queries";
import { FixtureCluster, HostedDemoPill } from "@/app/StatePill";
import { useViewportWidth } from "@/app/useCompactLayout";
import { HomePalette } from "./HomePalette";

/** Wordmark plus, in fixture mode, the fixture cluster (state and Retry API); on the hosted demo, its pill. Same Effects toggle as a System. */
export function HomeHeader() {
  return <EffectsPreferenceProvider><HomeHeaderBody /></EffectsPreferenceProvider>;
}

function HomeHeaderBody() {
  const { data: mode } = useClientMode();
  const systems = useSystems();
  const parts = useParts();
  const platform = usePlatform();
  const effects = useEffectsPreference();
  const width = useViewportWidth();
  const paletteTrigger = useRef<HTMLButtonElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handlePaletteShortcut(e, () => setPaletteOpen((open) => !open));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const retryApi = useRetryApi();
  const retry = mode === "fixture" ? retryApi : undefined;
  return <>
    <AppHeader badge={platform.data?.catMode ? <CatModeBadge /> : undefined} status={mode === "fixture" ? <FixtureCluster retry={width >= 1280 ? retry : undefined} /> : platform.data?.notice ? <HostedDemoPill notice={platform.data.notice} /> : undefined}
      actions={<HeaderActions paletteTriggerRef={paletteTrigger} onOpenPalette={() => setPaletteOpen(true)} retry={retry} effects={effects} />} />
    <HomePalette returnFocus={paletteTrigger} open={paletteOpen} onOpenChange={setPaletteOpen} systems={systems.data ?? []} parts={parts.data ?? []} retry={retry} />
  </>;
}
