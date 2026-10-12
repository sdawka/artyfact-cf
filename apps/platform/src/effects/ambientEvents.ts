/**
 * The `artyfact:fx` window event: views announce moments (a promotion, a failing gate, a selection) and the Shell's
 * ambient field ripples at the given viewport point. Fire-and-forget; nothing depends on a listener.
 */
export const FX_EVENT = "artyfact:fx";

export type AmbientFxKind = "promoted" | "submitted" | "commit" | "fail" | "select";

/** `x`/`y` are viewport (client) coordinates; without them the ripple starts at the field's centre. `strength` 0..2. */
export interface AmbientFxDetail {
  kind: AmbientFxKind;
  x?: number;
  y?: number;
  strength?: number;
}

const KINDS = new Set<string>(["promoted", "submitted", "commit", "fail", "select"]);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The detail of an `artyfact:fx` event, or null when it is malformed (other code may dispatch anything). */
export function parseAmbientFx(detail: unknown): AmbientFxDetail | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (typeof d.kind !== "string" || !KINDS.has(d.kind)) return null;
  const x = num(d.x);
  const y = num(d.y);
  const strength = num(d.strength);
  return {
    kind: d.kind as AmbientFxKind,
    ...(x !== undefined && { x }),
    ...(y !== undefined && { y }),
    ...(strength !== undefined && { strength: Math.min(2, Math.max(0, strength)) }),
  };
}

/** Announce `select` at the centre of `el` (a graph node). No-op without an element or a window. */
export function announceSelect(el: Element | null | undefined) {
  if (!el || typeof window === "undefined") return;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  const detail: AmbientFxDetail = { kind: "select", x: r.left + r.width / 2, y: r.top + r.height / 2 };
  window.dispatchEvent(new CustomEvent(FX_EVENT, { detail }));
}

/** The React Flow node element for `id` inside `root` (or the document). */
export const flowNodeElement = (id: string, root: ParentNode = document) =>
  root.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
