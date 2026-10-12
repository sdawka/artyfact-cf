/**
 * elk layout for React Flow graphs, shared by the Map (2.1) and Journeys (2.2).
 *
 * Callers describe a flat node list (`parentId` for nesting, React Flow style) and edges; `layoutGraph`
 * returns boxes with `x`/`y` relative to the parent (what React Flow wants for sub-flow children).
 * elk runs in a Web Worker (`elk.worker.ts`) when `Worker` exists, else on the main thread (tests).
 */
import type { ElkExtendedEdge, ElkNode, ElkPoint, LayoutOptions } from "elkjs/lib/elk-api";

export type { LayoutOptions, ElkPoint };

export interface LayoutNode {
  id: string;
  /** Leaf size. Ignored for nodes with children: elk sizes them around their content (+ `elk.padding`). */
  width: number;
  height: number;
  /** Containing node; it must also be in `nodes`. */
  parentId?: string;
  layoutOptions?: LayoutOptions;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  layoutOptions?: LayoutOptions;
}

export interface LayoutRequest {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** Root options; defaults to {@link LAYERED_RIGHT}. */
  layoutOptions?: LayoutOptions;
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  /** Per node id; `x`/`y` relative to the parent node (or the graph origin for roots). */
  nodes: Record<string, LayoutBox>;
  /** Orthogonal route per edge id in absolute graph coordinates (start, bends, end). */
  edges: Record<string, ElkPoint[]>;
  width: number;
  height: number;
}

/** Layered, left to right, hierarchy-aware, orthogonal edges. */
export const LAYERED_RIGHT: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.nodeNode": "24",
  "elk.spacing.edgeNode": "16",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
};

/** Node option for `elk.partitioning.partition` (activate with `elk.partitioning.activate: "true"` on the root). */
export const partition = (n: number): LayoutOptions => ({ "elk.partitioning.partition": String(n) });

/** Builds the nested elk graph. Edges between a node and its own ancestor are left out (elk rejects them). */
export function toElkGraph(req: LayoutRequest): ElkNode {
  const byId = new Map<string, ElkNode>();
  const parentOf = new Map<string, string>();
  for (const n of req.nodes) {
    byId.set(n.id, { id: n.id, width: n.width, height: n.height, ...(n.layoutOptions && { layoutOptions: n.layoutOptions }) });
    if (n.parentId) parentOf.set(n.id, n.parentId);
  }
  const root: ElkNode = { id: "__root", layoutOptions: req.layoutOptions ?? LAYERED_RIGHT, children: [], edges: [] };
  for (const n of req.nodes) {
    const node = byId.get(n.id)!;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) (parent.children ??= []).push(node);
    else root.children!.push(node);
  }
  const isAncestor = (a: string, b: string) => {
    for (let p = parentOf.get(b); p !== undefined; p = parentOf.get(p)) if (p === a) return true;
    return false;
  };
  for (const e of req.edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    if (isAncestor(e.source, e.target) || isAncestor(e.target, e.source)) continue;
    root.edges!.push({ id: e.id, sources: [e.source], targets: [e.target], ...(e.layoutOptions && { layoutOptions: e.layoutOptions }) });
  }
  return root;
}

const num = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);

/** Reads boxes (parent-relative) and edge routes (absolute) out of a laid-out elk graph. */
export function fromElkGraph(root: ElkNode): LayoutResult {
  const nodes: Record<string, LayoutBox> = {};
  const abs = new Map<string, ElkPoint>([[root.id, { x: 0, y: 0 }]]);
  const edges: Record<string, ElkPoint[]> = {};
  const walkEdges = (owner: ElkNode) => {
    for (const e of (owner.edges ?? []) as (ElkExtendedEdge & { container?: string })[]) {
      const origin = abs.get(e.container ?? owner.id) ?? abs.get(owner.id) ?? { x: 0, y: 0 };
      const pts: ElkPoint[] = [];
      for (const s of e.sections ?? []) {
        for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) pts.push({ x: origin.x + num(p.x), y: origin.y + num(p.y) });
      }
      edges[e.id] = pts;
    }
  };
  const walk = (parent: ElkNode) => {
    const origin = abs.get(parent.id)!;
    for (const c of parent.children ?? []) {
      const box = { x: num(c.x), y: num(c.y), width: num(c.width), height: num(c.height) };
      nodes[c.id] = box;
      abs.set(c.id, { x: origin.x + box.x, y: origin.y + box.y });
      walk(c);
    }
  };
  walk(root);
  const walkAllEdges = (n: ElkNode) => {
    walkEdges(n);
    for (const c of n.children ?? []) walkAllEdges(c);
  };
  walkAllEdges(root);
  return { nodes, edges, width: num(root.width), height: num(root.height) };
}

/** Boxes in absolute graph coordinates (parent offsets added), e.g. for drawing overlays across levels. */
export function absoluteBoxes(result: LayoutResult, req: Pick<LayoutRequest, "nodes">): Record<string, LayoutBox> {
  const parentOf = new Map(req.nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId!]));
  const out: Record<string, LayoutBox> = {};
  const resolve = (id: string): LayoutBox | undefined => {
    if (out[id]) return out[id];
    const box = result.nodes[id];
    if (!box) return undefined;
    const p = parentOf.get(id);
    const pb = p ? resolve(p) : undefined;
    out[id] = { ...box, x: box.x + (pb?.x ?? 0), y: box.y + (pb?.y ?? 0) };
    return out[id];
  };
  for (const id of Object.keys(result.nodes)) resolve(id);
  return out;
}

interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
  terminateWorker?(): void;
}

/** A started worker-backed elk plus a promise that rejects if the worker script fails to load or errors. */
interface WorkerElk {
  elk: ElkLike;
  failed: Promise<never>;
}

/** Creates the elk worker. Replaceable in tests via {@link setElkWorkerFactory}. */
type WorkerFactory = () => Worker;
const defaultFactory: WorkerFactory = () => new Worker(new URL("./elk.worker.ts", import.meta.url), { type: "module" });
let workerFactory: WorkerFactory | null = null;

/** Tests: force the worker path with a fake worker (`null` restores the default and environment detection). */
export function setElkWorkerFactory(factory: WorkerFactory | null) {
  workerFactory = factory;
  resetWorker();
  workerBroken = false;
}

/** How long a worker layout may take (including loading the worker script) before falling back. */
export const WORKER_TIMEOUT_MS = 10_000;

let workerElk: Promise<WorkerElk> | null = null;
let threadElk: Promise<ElkLike> | null = null;
/** Set after a worker failure; later layouts go straight to the main thread. */
let workerBroken = false;

function inThread(): Promise<ElkLike> {
  threadElk ??= import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  return threadElk;
}

function inWorker(): Promise<WorkerElk> {
  workerElk ??= import("elkjs/lib/elk-api.js").then((m) => {
    let fail: (err: unknown) => void = () => {};
    const failed = new Promise<never>((_, reject) => (fail = reject));
    failed.catch(() => {}); // observed by the race in layoutGraph; never an unhandled rejection
    const elk = new m.default({
      workerFactory: () => {
        const w = (workerFactory ?? defaultFactory)();
        // elk-api only listens for messages, so a worker that fails to load would hang every layout.
        w.addEventListener("error", (e) => fail(new Error(`elk worker error: ${(e as ErrorEvent).message ?? "failed to load"}`)));
        w.addEventListener("messageerror", () => fail(new Error("elk worker message error")));
        return w;
      },
    });
    return { elk, failed };
  });
  return workerElk;
}

function resetWorker() {
  const pending = workerElk;
  workerElk = null;
  void pending?.then((w) => w.elk.terminateWorker?.()).catch(() => {});
}

const canUseWorker = () =>
  workerFactory !== null ||
  (typeof Worker !== "undefined" && typeof window !== "undefined" && !/jsdom/i.test(navigator.userAgent));

/**
 * Lays out `req`. Uses the Web Worker when available (`worker: false` forces the main thread).
 * If the worker errors, fails to load, or takes longer than `timeoutMs`, it is terminated and the
 * layout runs on the main thread (and later layouts skip the worker). `signal` cancels pending work:
 * the timer is cleared, nothing new is started, and the promise rejects with an `AbortError`.
 */
export async function layoutGraph(
  req: LayoutRequest,
  opts: { worker?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<LayoutResult> {
  const { signal } = opts;
  const aborted = () => new DOMException("elk layout aborted", "AbortError");
  if (signal?.aborted) throw aborted();
  const graph = toElkGraph(req);
  if (opts.worker !== false && !workerBroken && canUseWorker()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let wasAborted = false;
    try {
      const { elk, failed } = await inWorker();
      if (signal?.aborted) throw aborted();
      // The fallback timer and the abort listener both settle this race, and `finally` clears both,
      // so neither can fire after the layout has finished or been cancelled.
      const cancelled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("elk worker timed out")), opts.timeoutMs ?? WORKER_TIMEOUT_MS);
        onAbort = () => {
          wasAborted = true;
          reject(aborted());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      // postMessage clones the graph, so `graph` is still pristine for the fallback.
      return fromElkGraph(await Promise.race([elk.layout(graph), failed, cancelled]));
    } catch (err) {
      // A cancelled layout is not a worker failure: leave the shared worker alone and do not fall back.
      if (wasAborted || signal?.aborted) throw aborted();
      console.warn("artyfact: elk worker failed, laying out on the main thread", err);
      workerBroken = true;
      resetWorker();
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }
  const thread = await inThread();
  if (signal?.aborted) throw aborted(); // never start elk work for an unmounted caller
  const result = await thread.layout(graph);
  if (signal?.aborted) throw aborted();
  return fromElkGraph(result);
}

/** A stable string for a request's shape (ids, sizes, nesting, options, edges): the memo key for its layout. */
export function requestKey(req: LayoutRequest): string {
  const opts = (o?: LayoutOptions) => (o ? Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join(",") : "");
  const parts = [opts(req.layoutOptions)];
  for (const n of req.nodes) parts.push(`n${n.id}|${n.width}x${n.height}|${n.parentId ?? ""}|${opts(n.layoutOptions)}`);
  for (const e of req.edges) parts.push(`e${e.id}|${e.source}>${e.target}|${opts(e.layoutOptions)}`);
  return hash(parts.join("\n"));
}

/** cyrb53: a fast 53-bit string hash, as base-36 (plus length to make collisions even less likely). */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${s.length.toString(36)}`;
}
