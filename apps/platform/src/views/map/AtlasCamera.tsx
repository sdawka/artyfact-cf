import { useEffect, useRef, useState } from "react";
import { Controls, useReactFlow, type Viewport } from "@xyflow/react";
import type { AtlasLayout } from "./atlasLayout";
import type { MapGraph } from "./useMapGraph";
import { useModel } from "@/model/useModel";
import { boundaryContextIds } from "./atlasConnections";
import { initialAtlasViewport } from "./atlasViewport";
import { ENVIRONMENT_SCOPE } from "./useMapGraph";
import styles from "./MapView.module.css";

/** Session-local scope cameras survive scope changes and Details without persisting model data. */
const cameras = new Map<string, Viewport>();
export const saveAtlasCamera = (key: string, viewport: Viewport) => { cameras.set(key, viewport); };
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function AtlasCamera({ cameraKey, layout, canvas, graph, focusId, locate, onLocate }: {
  cameraKey: string; layout: AtlasLayout; canvas: HTMLElement | null; graph: MapGraph; focusId: string | null;
  locate: { id: string; sequence: number } | null; onLocate: (id: string) => void;
}) {
  const rf = useReactFlow();
  const { index } = useModel();
  const active = useRef<string | null>(null);
  const located = useRef<number | null>(null);
  const [outside, setOutside] = useState<string[]>([]);
  useEffect(() => {
    if (!canvas) return;
    const fit = () => {
      if (active.current === cameraKey) return;
      const width = canvas.clientWidth || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      active.current = cameraKey;
      void rf.setViewport(cameras.get(cameraKey) ?? initialAtlasViewport(layout, graph, width, height));
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(canvas);
    return () => ro?.disconnect();
  }, [cameraKey, layout, graph.scope, canvas, rf]);
  useEffect(() => {
    if (!locate || located.current === locate.sequence) return;
    const box = layout.boxes[locate.id];
    if (box) {
      located.current = locate.sequence;
      void rf.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: rf.getViewport().zoom, duration: reduced() ? 0 : 180 }).then(() => saveAtlasCamera(cameraKey, rf.getViewport()));
    }
  }, [locate, layout, rf, cameraKey]);
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
