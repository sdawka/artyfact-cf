import { EffectsProvider, useSystemReducedMotion } from "@artyfact/effects";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** localStorage key for the user's Effects switch ("on" / "off"). Absent: follow `prefers-reduced-motion`. */
export const EFFECTS_KEY = "artyfact.effects";

/** The stored choice, or null when there is none or storage is unavailable (private mode, blocked site data). */
export function readEffectsPreference(): boolean | null {
  try {
    const v = window.localStorage.getItem(EFFECTS_KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

function writeEffectsPreference(on: boolean) {
  try {
    window.localStorage.setItem(EFFECTS_KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

interface EffectsPreference {
  /** Effects render with WebGL and decorative motion. */
  enabled: boolean;
  setEnabled(on: boolean): void;
  toggle(): void;
}

const Ctx = createContext<EffectsPreference>({ enabled: true, setEnabled: () => {}, toggle: () => {} });

/**
 * The user's Effects switch, persisted in localStorage. Defaults to on, or off under `prefers-reduced-motion`.
 * Wraps `EffectsProvider`, so every Orb and AmbientField below follows it.
 */
export function EffectsPreferenceProvider({ children }: { children: ReactNode }) {
  const reduced = useSystemReducedMotion();
  const [stored, setStored] = useState(readEffectsPreference);
  const enabled = stored ?? !reduced;
  const setEnabled = useCallback((on: boolean) => {
    setStored(on);
    writeEffectsPreference(on);
  }, []);
  const value = useMemo(() => ({ enabled, setEnabled, toggle: () => setEnabled(!enabled) }), [enabled, setEnabled]);
  return (
    <Ctx.Provider value={value}>
      <EffectsProvider enabled={enabled}>{children}</EffectsProvider>
    </Ctx.Provider>
  );
}

export const useEffectsPreference = () => useContext(Ctx);
