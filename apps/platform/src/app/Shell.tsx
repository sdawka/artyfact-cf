import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { Button, Sheet } from "@/components/ui";
import { useCompactLayout } from "./useCompactLayout";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useParams } from "react-router";
import { useSystemEvents } from "@/api/queries";
import { EffectsPreferenceProvider, useEffectsPreference } from "@/effects/effectsPreference";
import { ShellAmbient } from "@/effects/ShellAmbient";
import { InspectorDrawer } from "@/inspector/InspectorDrawer";
import { GO_KEYS } from "@/model/kinds";
import { RouteScope } from "@/components/PageHeader/PageHeader";
import { useModel } from "@/model/useModel";
import { useSystemRoute } from "@/model/useSelection";
import { CommandPalette } from "./CommandPalette";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { isTyping, useShellShortcuts } from "./useShellShortcuts";
import styles from "./Shell.module.css";

export { GO_KEYS };

export { isTyping };

/** App frame: TopBar over SideNav · main · Inspector (grid `auto 1fr auto`), over the ambient field. */
export function Shell() {
  return (
    <EffectsPreferenceProvider>
      <ShellAmbient />
      <ShellFrame />
    </EffectsPreferenceProvider>
  );
}

function ShellFrame() {
  const { thingId } = useParams();
  const { view } = useSystemRoute();
  const { bundle } = useModel();
  const thing = bundle.model.things.find((entry) => entry.id === thingId);
  const compact = useCompactLayout();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!compact) setNavigationOpen(false); }, [compact]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const togglePalette = useCallback(() => setPaletteOpen((open) => !open), []);
  useShellShortcuts(togglePalette, paletteOpen);
  useSystemEvents();
  const { enabled } = useEffectsPreference();
  return (
    <div className={styles.shell} data-effects={enabled ? "on" : "off"} data-view={view}>
      <a className="sr-only" href="#main">Skip to content</a>
      <TopBar onOpenPalette={openPalette} navigation={compact ? <Button ref={menuButton} onClick={() => setNavigationOpen(true)} aria-expanded={navigationOpen} aria-haspopup="dialog"><HamburgerMenuIcon /> Menu</Button> : undefined} />
      {compact ? <Sheet open={navigationOpen} onOpenChange={setNavigationOpen} title="Navigation" side="left" className={styles.navigationSheet}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => { event.preventDefault(); menuButton.current?.focus(); }}>
        <SideNav onNavigate={() => setNavigationOpen(false)} />
      </Sheet> : <SideNav />}
      <main id="main" className={styles.main} tabIndex={-1}>
        {/* Fallback scope line for views that have not adopted PageHeader; hidden once the view renders its own. */}
        {thing && view && view !== "overview" && view !== "map" && <div className={styles.scopeFallback}><RouteScope /></div>}
        <Suspense fallback={<p className={styles.loading}>Loading view…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <InspectorDrawer />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
