import { useEffect, useRef } from "react";
import { depthGesture, newGesture } from "./atlasGestures";

/** React Flow handles one-finger/ordinary-wheel pan. These native listeners own only depth gestures. */
export function useDepthGestures(canvas: HTMLElement | null, enter: (id?: string) => void, up: () => void) {
  const actions = useRef({ enter, up });
  actions.current = { enter, up };
  useEffect(() => {
    if (!canvas) return;
    let wheel = newGesture();
    let pinch = newGesture();
    let release: ReturnType<typeof setTimeout> | undefined;
    let distance = 0;
    let pinchTarget: string | undefined;
    const nodeAt = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(".react-flow__node")?.dataset.id : undefined;
    const transition = (direction: "enter" | "up" | null, id?: string) => {
      if (direction === "enter") actions.current.enter(id);
      if (direction === "up") actions.current.up();
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (release) clearTimeout(release);
      release = setTimeout(() => { wheel = newGesture(); }, 220);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight || 600 : 1;
      transition(depthGesture(wheel, -event.deltaY * unit / 600), nodeAt(event.target));
    };
    const measure = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      pinch = newGesture();
      distance = measure(event.touches);
      const a = event.touches[0]!, b = event.touches[1]!;
      pinchTarget = nodeAt(document.elementFromPoint?.((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) ?? event.target);
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !distance) return;
      event.preventDefault();
      event.stopPropagation();
      const next = measure(event.touches);
      if (next > 0) transition(depthGesture(pinch, Math.log(next / distance)), pinchTarget);
      distance = next;
    };
    const onEnd = (event: TouchEvent) => { if (event.touches.length < 2) distance = 0; };
    const options = { passive: false, capture: true };
    canvas.addEventListener("wheel", onWheel, options);
    canvas.addEventListener("touchstart", onStart, options);
    canvas.addEventListener("touchmove", onMove, options);
    canvas.addEventListener("touchend", onEnd, options);
    canvas.addEventListener("touchcancel", onEnd, options);
    return () => {
      if (release) clearTimeout(release);
      canvas.removeEventListener("wheel", onWheel, true);
      canvas.removeEventListener("touchstart", onStart, true);
      canvas.removeEventListener("touchmove", onMove, true);
      canvas.removeEventListener("touchend", onEnd, true);
      canvas.removeEventListener("touchcancel", onEnd, true);
    };
  }, [canvas]);
}
