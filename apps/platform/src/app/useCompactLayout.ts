import { useEffect, useState } from "react";

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
export function useCompactLayout() { return useViewportWidth() < 1024; }
