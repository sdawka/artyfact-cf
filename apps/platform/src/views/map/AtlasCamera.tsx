import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Controls, useReactFlow, type Viewport } from "@xyflow/react";
import { useSystemReducedMotion } from "@artyfact/effects";
import { useEffectsPreference } from "@/effects/effectsPreference";
import { anchoredViewport, readableLocateViewport, CameraSequence, cameraDuration, type AtlasTravel } from "./atlasCameraMotion";
import type { AtlasLayout } from "./atlasLayout";
import type { MapGraph } from "./useMapGraph";
import { useModel } from "@/model/useModel";
import { boundaryContextIds } from "./atlasConnections";
import { initialAtlasViewport } from "./atlasViewport";
import { ENVIRONMENT_SCOPE } from "./useMapGraph";
import styles from "./MapView.module.css";

/** Session-local scope cameras survive scope changes and Details without persisting model data. */
const cameras = new Map<string, Viewport>();
export const saveAtlasCamera = (key: string, viewport: Viewport) => {
  // A hidden/zero-size pane can yield a nonfinite intermediate d3 frame. Never retain it.
  if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || viewport.zoom <= 0) return;
  cameras.set(key, viewport);
};


export function AtlasCamera({ cameraKey, layout, canvas, graph, focusId, travel, onTravel, onCancelTravel, locate, onLocate }: {
  cameraKey: string; layout: AtlasLayout; canvas: HTMLElement | null; graph: MapGraph; focusId: string | null;
  travel: AtlasTravel | null; onTravel: (request: AtlasTravel) => boolean | void; onCancelTravel: () => void;
  locate: { id: string; sequence: number } | null; onLocate: (id: string) => void;
}) {
  const rf = useReactFlow();
  const { index } = useModel();
  const { enabled } = useEffectsPreference();
  const reduced = useSystemReducedMotion();
  const sequence = useRef(new CameraSequence());
  const handoff = useRef<{ target: string; id: string; anchor: { x: number; y: number }; renderedWidth: number } | null>(null);
  const traveling = useRef(false);
  const approachActive = useRef(false);
  const handledTravel = useRef<number | null>(null);
  const travelCallbacks = useRef({ onTravel, onCancelTravel });
  travelCallbacks.current = { onTravel, onCancelTravel };
  const motionDuration = cameraDuration(enabled, reduced, 240);
  const active = useRef<string | null>(null);
  const located = useRef<number | null>(null);
  const [outside, setOutside] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (!canvas || !rf.viewportInitialized) return;
    const fit = () => {
      if (active.current === cameraKey) return;
      const width = canvas.clientWidth || canvas.offsetWidth, height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      active.current = cameraKey;
      const ticket = sequence.current.begin();
      const final = cameras.get(cameraKey) ?? initialAtlasViewport(layout, graph, width, height);
      const transfer = handoff.current;
      handoff.current = null;
      const box = transfer?.target === graph.scope ? layout.boxes[transfer.id] : undefined;
      if (transfer && box && motionDuration) {
        const start = anchoredViewport(box, transfer.anchor, transfer.renderedWidth / box.width);
        traveling.current = true;
        void rf.setViewport(start).then(() => {
          if (!sequence.current.isCurrent(ticket)) return;
          return rf.setViewport(final, { duration: motionDuration }).then(() => {
            if (!sequence.current.isCurrent(ticket)) return;
            traveling.current = false;
            saveAtlasCamera(cameraKey, final);
          });
        });
      } else { traveling.current = false; void rf.setViewport(final); }
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(canvas);
    return () => ro?.disconnect();
  }, [cameraKey, layout, graph.scope, canvas, rf, motionDuration]);
  useEffect(() => {
    if (!travel && approachActive.current) {
      sequence.current.cancel(); approachActive.current = false; traveling.current = false; handoff.current = null;
      void rf.setViewport(rf.getViewport());
    }
    if (!travel || !canvas || !rf.viewportInitialized || (travel.source && (!travel.historyKey || travel.source !== graph.scope)) || handledTravel.current === travel.sequence) return;
    handledTravel.current = travel.sequence;
    approachActive.current = true;
    const ticket = sequence.current.begin();
    const before = rf.getViewport();
    saveAtlasCamera(cameraKey, before);
    const box = layout.boxes[travel.id];
    const anchor = box ? { x: (box.x + box.width / 2) * before.zoom + before.x, y: (box.y + box.height / 2) * before.zoom + before.y } : { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const approach = box ? anchoredViewport(box, anchor, before.zoom * (travel.kind === "up" ? .82 : 1.2)) : before;
    traveling.current = true;
    void rf.setViewport(approach, { duration: cameraDuration(enabled, reduced, 150) }).then(() => {
      if (!sequence.current.isCurrent(ticket)) return;
      approachActive.current = false;
      handoff.current = { target: travel.target, id: travel.kind === "up" ? travel.id : travel.focus ?? travel.target, anchor, renderedWidth: (box?.width ?? 432) * approach.zoom };
      traveling.current = false;
      if (travelCallbacks.current.onTravel(travel) === false) handoff.current = null;
    });
  }, [travel, canvas, rf, cameraKey, layout, graph.scope, enabled, reduced]);
  useEffect(() => {
    if (!locate || located.current === locate.sequence || !canvas || !rf.viewportInitialized) return;
    const box = layout.boxes[locate.id];
    if (!box) return;
    located.current = locate.sequence;
    const ticket = sequence.current.begin();
    const target = readableLocateViewport(box, canvas.clientWidth || canvas.offsetWidth, canvas.clientHeight || canvas.offsetHeight, rf.getViewport().zoom);
    traveling.current = true;
    void rf.setViewport(target, { duration: cameraDuration(enabled, reduced, 180) }).then(() => {
      if (!sequence.current.isCurrent(ticket)) return;
      traveling.current = false;
      saveAtlasCamera(cameraKey, rf.getViewport());
    });
  }, [locate, layout, rf, cameraKey, canvas, motionDuration]);
  useEffect(() => {
    if (!canvas) return;
    const interrupt = (event: Event) => {
      // Overlay actions (such as closing Tree) are not pan/zoom gestures.
      if (!(event.target instanceof Element) || !event.target.closest(".react-flow")) return;
      // A continuing depth gesture owns its latched navigation request.
      if (event instanceof WheelEvent && (event.ctrlKey || event.metaKey)) return;
      if (event instanceof TouchEvent && event.touches.length === 2) return;
      if (!traveling.current) return;
      sequence.current.cancel();
      approachActive.current = false;
      handoff.current = null;
      traveling.current = false;
      // React Flow's immediate setViewport interrupts its current d3 zoom transition.
      void rf.setViewport(rf.getViewport());
      saveAtlasCamera(cameraKey, rf.getViewport());
      travelCallbacks.current.onCancelTravel();
    };
    canvas.addEventListener("pointerdown", interrupt, true);
    canvas.addEventListener("wheel", interrupt, true);
    canvas.addEventListener("touchstart", interrupt, true);
    return () => { canvas.removeEventListener("pointerdown", interrupt, true); canvas.removeEventListener("wheel", interrupt, true); canvas.removeEventListener("touchstart", interrupt, true); };
  }, [canvas, rf, cameraKey]);
  useEffect(() => () => { sequence.current.cancel(); }, []);
  useEffect(() => {
    if (!canvas || (!focusId && graph.scope !== ENVIRONMENT_SCOPE)) { setOutside([]); return; }
    const update = () => {
      const viewport = rf.getViewport();
      const connected = new Set(graph.scope === ENVIRONMENT_SCOPE ? graph.nodes.filter((node) => node.role === "external").map((node) => node.id) : boundaryContextIds(graph, focusId, index));
      const width = canvas.clientWidth || canvas.offsetWidth, height = canvas.clientHeight || canvas.offsetHeight;
      setOutside([...connected].filter((id) => {
        const b = layout.boxes[id];
        if (!b) return false;
        const x = b.x * viewport.zoom + viewport.x, y = b.y * viewport.zoom + viewport.y;
        return x + b.width * viewport.zoom < 0 || y + b.height * viewport.zoom < 0 || x > width || y > height;
      }));
    };
    update();
    // Viewport updates are event-driven, including controls and animated Locate.
    canvas.addEventListener("atlas-camera-move", update);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(canvas);
    return () => { canvas.removeEventListener("atlas-camera-move", update); ro?.disconnect(); };
  }, [canvas, focusId, graph, layout, rf, index]);
  const saveControlCamera = () => requestAnimationFrame(() => saveAtlasCamera(cameraKey, rf.getViewport()));
  const controls = <Controls showInteractive={false} position="bottom-right" onZoomIn={saveControlCamera} onZoomOut={saveControlCamera} onFitView={saveControlCamera} />;
  if (graph.scope === ENVIRONMENT_SCOPE) return <>{controls} <div className={styles.actors} aria-label="Environment actors">
    <span>Outside System</span>{graph.nodes.filter((node) => node.role === "external").map((node) => <button key={node.id} onClick={() => onLocate(node.id)}>{node.name}{outside.includes(node.id) && <span aria-hidden="true"> ↗</span>}</button>)}
  </div></>;
  return <>{controls}{outside.length ? <div className={styles.offscreen} aria-label="Offscreen connections">{outside.map((id) => <button key={id} onClick={() => onLocate(id)}>Locate {graph.nodes.find((n) => n.id === id)?.name ?? id} <span aria-hidden="true">↗</span></button>)}</div> : null}</>;
}
