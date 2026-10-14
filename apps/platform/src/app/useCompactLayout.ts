import { useEffect, useState } from "react";

/** Below this width the rail becomes a Sheet and the Inspector a bottom sheet (CSS uses `max-width: 1023px`). */
export const SHELL_COMPACT_MAX = 1024;
/** Width of the desktop rail; the Inspector never squeezes the view below `rail + 400`. */
export const SHELL_RAIL_WIDTH = 256;

/** The shell and its overlays share one responsive boundary. */
export function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return width;
}
export function useCompactLayout() { return useViewportWidth() < SHELL_COMPACT_MAX; }
