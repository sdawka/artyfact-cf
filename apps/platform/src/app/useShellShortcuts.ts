import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { GO_KEYS } from "@/model/kinds";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection, useSystemRoute } from "@/model/useSelection";
import { handlePaletteShortcut } from "./paletteShortcut";

/** True when a key event comes from a text field (shortcuts should ignore it). Views reuse it. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "combobox");

/**
 * Shell keyboard: Ctrl/Cmd K palette, `g` then a view key, `[` `]` siblings of the focused node, Esc clears focus or closes
 * Map details. Ignored while typing and while any overlay is open. The palette lists every go-key.
 */
export function useShellShortcuts(togglePalette: () => void, paletteOpen: boolean) {
  const { focusId, setFocus, clear } = useSelection();
  const { siblings } = useModel();
  const { view } = useSystemRoute();
  const [params] = useSearchParams();
  const { closeDetails } = useAtlasNavigation();
  const detailsOpen = view === "map" && params.get("inspect") === "1";
  const navigate = useNavigate();
  const href = useKeepParams();
  const gAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handlePaletteShortcut(e, togglePalette)) return;
      if (e.defaultPrevented || document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]') || paletteOpen || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && focusId) {
        if (detailsOpen) closeDetails();
        else clear();
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
  }, [focusId, setFocus, clear, siblings, navigate, href, togglePalette, paletteOpen, detailsOpen, closeDetails]);
}
