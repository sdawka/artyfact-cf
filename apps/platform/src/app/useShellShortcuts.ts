import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { GO_KEYS } from "@/model/kinds";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection, useSystemRoute } from "@/model/useSelection";
import { handlePaletteShortcut } from "./paletteShortcut";

/** True when a key event comes from a text field (shortcuts should ignore it). Views reuse it. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "combobox");

/** When the last `g` was pressed (0: none). Module state so views can tell a go-key sequence is under way. */
let gAt = 0;
const GO_WINDOW_MS = 1000;

/**
 * True while `g` was just pressed and `key` would complete a go-key (`g` then a view key). View key handlers that share a
 * letter with a go-key (Review's `j`/`k`) leave such a key to the shell.
 */
export const isGoKeyPending = (key: string) => !!GO_KEYS[key] && Date.now() - gAt < GO_WINDOW_MS;

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
      if (isGoKeyPending(e.key)) {
        gAt = 0;
        void navigate(href(GO_KEYS[e.key]!));
        return;
      }
      gAt = e.key === "g" ? now : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, setFocus, clear, siblings, navigate, href, togglePalette, paletteOpen, detailsOpen, closeDetails]);
}
