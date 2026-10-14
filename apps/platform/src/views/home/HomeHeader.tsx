import { EffectsPreferenceProvider } from "@/effects/effectsPreference";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/app/AppHeader";
import { handlePaletteShortcut } from "@/app/paletteShortcut";
import { HeaderActions } from "@/app/HeaderActions";
import { resetClientMode } from "@/api/client";
import { useClientMode, useParts, useSystems } from "@/api/queries";
import { FIXTURE_TITLE, StatePill } from "@/app/StatePill";
import { HomePalette } from "./HomePalette";

/** Wordmark plus, in fixture mode, the "fixture data" pill and a Retry button. */
export function HomeHeader() {
  const { data: mode } = useClientMode();
  const qc = useQueryClient();
  const systems = useSystems();
  const parts = useParts();
  const paletteTrigger = useRef<HTMLButtonElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handlePaletteShortcut(e, () => setPaletteOpen((open) => !open));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const retry = () => { resetClientMode(); void qc.invalidateQueries(); };
  return <EffectsPreferenceProvider>
    <AppHeader status={mode === "fixture" ? <StatePill state="fixture" title={FIXTURE_TITLE}>fixture data</StatePill> : undefined}
      actions={<HeaderActions paletteTriggerRef={paletteTrigger} onOpenPalette={() => setPaletteOpen(true)} retry={mode === "fixture" ? retry : undefined} />} />
    <HomePalette returnFocus={paletteTrigger} open={paletteOpen} onOpenChange={setPaletteOpen} systems={systems.data ?? []} parts={parts.data ?? []} />
  </EffectsPreferenceProvider>;
}
