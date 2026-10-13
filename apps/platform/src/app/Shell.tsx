import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router";
import { useSystemEvents } from "@/api/queries";
import { EffectsPreferenceProvider, useEffectsPreference } from "@/effects/effectsPreference";
import { ShellAmbient } from "@/effects/ShellAmbient";
import { InspectorDrawer } from "@/inspector/InspectorDrawer";
import { GO_KEYS, type ViewName } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { thingPath, useKeepParams, useSelection, useSystemRoute, viewPath } from "@/model/useSelection";
import { CommandPalette } from "./CommandPalette";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import styles from "./Shell.module.css";

export { GO_KEYS };

const SYSTEM_VIEW_CONTEXT: Partial<Record<ViewName, string>> = {
  journeys: "Journeys includes journeys from the whole System.",
  theory: "Theory describes purpose and outcomes for the whole System.",
  code: "Code shows saved files for the whole System.",
  work: "Work shows changes for the whole System.",
  review: "Review shows decisions for the whole System.",
  evaluations: "Evaluations includes evidence from the whole System.",
  changelog: "Changelog includes changes to the whole System.",
  compare: "Compare compares revisions of the whole System.",
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
  const { thingId } = useParams();
  const { systemId, rev, view } = useSystemRoute();
  const { bundle } = useModel();
  const thing = bundle.model.things.find((entry) => entry.id === thingId);
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
        {thing && view && view !== "overview" && <nav className={styles.breadcrumb} aria-label="Thing workspace breadcrumb">
          <Link to={viewPath(systemId, rev, "overview")} className="u-marker">{bundle.model.system.name}</Link>
          <span aria-hidden="true">/</span><Link to={thingPath(systemId, rev, thing.id)} className="u-marker">{thing.name}</Link>
          <Link to={viewPath(systemId, rev, "overview")} className="u-marker">System overview</Link>
        </nav>}
        {thing && view && SYSTEM_VIEW_CONTEXT[view] && <p className={styles.context}>{SYSTEM_VIEW_CONTEXT[view]}</p>}
        <Suspense fallback={<p className={styles.loading}>Loading view…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <InspectorDrawer />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
