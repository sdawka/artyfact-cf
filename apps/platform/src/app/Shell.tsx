import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { useSystemEvents } from "@/api/queries";
import { EffectsPreferenceProvider, useEffectsPreference } from "@/effects/effectsPreference";
import { ShellAmbient } from "@/effects/ShellAmbient";
import { InspectorDrawer } from "@/inspector/InspectorDrawer";
import type { ViewName } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { CommandPalette } from "./CommandPalette";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import styles from "./Shell.module.css";

/** `g` + key go-to shortcuts. */
export const GO_KEYS: Record<string, ViewName> = {
  o: "overview", m: "map", j: "journeys", t: "theory", w: "work", e: "evaluations", h: "history",
};

/** True when a key event comes from a text field (shortcuts should ignore it). Views reuse it. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function useShellShortcuts(openPalette: () => void, paletteOpen: boolean) {
  const { focusId, setFocus, clear } = useSelection();
  const { siblings } = useModel();
  const navigate = useNavigate();
  const href = useKeepParams();
  const gAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (paletteOpen || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && focusId) {
        clear();
        return;
      }
      if ((e.key === "[" || e.key === "]") && focusId) {
        const sibs = siblings(focusId);
        const i = sibs.findIndex((s) => s.id === focusId);
        const next = sibs[i + (e.key === "]" ? 1 : -1)];
        if (next) setFocus(next.id);
        return;
      }
      const now = Date.now();
      if (now - gAt.current < 1000 && GO_KEYS[e.key]) {
        gAt.current = 0;
        void navigate(href(GO_KEYS[e.key]!));
        return;
      }
      gAt.current = e.key === "g" ? now : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, setFocus, clear, siblings, navigate, href, openPalette, paletteOpen]);
}

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useShellShortcuts(openPalette, paletteOpen);
  useSystemEvents();
  const { enabled } = useEffectsPreference();
  return (
    <div className={styles.shell} data-effects={enabled ? "on" : "off"}>
      <a className="sr-only" href="#main">Skip to content</a>
      <TopBar onOpenPalette={openPalette} />
      <SideNav />
      <main id="main" className={styles.main} tabIndex={-1}>
        <Suspense fallback={<p className={styles.loading}>Loading view…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <InspectorDrawer />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
