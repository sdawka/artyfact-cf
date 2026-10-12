import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { absoluteBoxes, layoutGraph, LAYERED_RIGHT, partition, requestKey, setElkWorkerFactory, toElkGraph, type LayoutRequest } from "./elk";

const req: LayoutRequest = {
  layoutOptions: { ...LAYERED_RIGHT, "elk.partitioning.activate": "true" },
  nodes: [
    { id: "ext", width: 160, height: 40, layoutOptions: partition(0) },
    { id: "group", width: 0, height: 0, layoutOptions: { ...partition(1), "elk.padding": "[top=40,left=16,bottom=16,right=16]" } },
    { id: "a", width: 120, height: 40, parentId: "group" },
    { id: "b", width: 120, height: 40, parentId: "group" },
    { id: "out", width: 120, height: 40, layoutOptions: partition(1) },
  ],
  edges: [
    { id: "a-b", source: "a", target: "b" },
    { id: "a-ext", source: "a", target: "ext" },
    { id: "b-out", source: "b", target: "out" },
    { id: "group-a", source: "group", target: "a" },
  ],
};

describe("toElkGraph", () => {
  it("nests children under their parent and drops edges between a node and its ancestor", () => {
    const g = toElkGraph(req);
    expect(g.children?.map((c) => c.id)).toEqual(["ext", "group", "out"]);
    expect(g.children?.[1]?.children?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(g.edges?.map((e) => e.id)).toEqual(["a-b", "a-ext", "b-out"]);
  });
});

describe("layoutGraph (in-thread fallback)", () => {
  it("returns numeric positions, parent bounds containing children, and partition order", async () => {
    const out = await layoutGraph(req);
    for (const n of req.nodes) {
      const box = out.nodes[n.id];
      expect(box, n.id).toBeDefined();
      for (const v of [box!.x, box!.y, box!.width, box!.height]) expect(Number.isFinite(v), `${n.id} ${v}`).toBe(true);
    }
    const group = out.nodes.group!;
    for (const id of ["a", "b"]) {
      const c = out.nodes[id]!; // relative to the group
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(group.width);
      expect(c.y + c.height).toBeLessThanOrEqual(group.height);
    }
    const abs = absoluteBoxes(out, req);
    expect(abs.ext!.x + abs.ext!.width).toBeLessThanOrEqual(abs.group!.x);
    expect(abs.a!.x).toBe(group.x + out.nodes.a!.x);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});

class FakeWorker extends EventTarget {
  onmessage: ((e: MessageEvent) => void) | null = null;
  terminated = false;
  constructor(private mode: "error" | "silent") {
    super();
  }
  postMessage() {
    if (this.mode === "error") setTimeout(() => this.dispatchEvent(new Event("error")), 0);
  }
  terminate() {
    this.terminated = true;
  }
}

describe("layoutGraph worker failures", () => {
  beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => {
    setElkWorkerFactory(null);
    vi.restoreAllMocks();
  });

  it("falls back to the main thread when the worker fails to load", async () => {
    const workers: FakeWorker[] = [];
    setElkWorkerFactory(() => {
      const w = new FakeWorker("error");
      workers.push(w);
      return w as unknown as Worker;
    });
    const out = await layoutGraph(req);
    expect(Number.isFinite(out.nodes.a!.x)).toBe(true);
    expect(workers).toHaveLength(1);
    await vi.waitFor(() => expect(workers[0]!.terminated).toBe(true));
  });

  it("falls back when the worker never answers", async () => {
    const workers: FakeWorker[] = [];
    setElkWorkerFactory(() => {
      const w = new FakeWorker("silent");
      workers.push(w);
      return w as unknown as Worker;
    });
    const out = await layoutGraph(req, { timeoutMs: 30 });
    expect(out.width).toBeGreaterThan(0);
    await vi.waitFor(() => expect(workers[0]!.terminated).toBe(true));
  });

  it("aborts a pending worker layout without falling back, and clears the fallback timer", async () => {
    setElkWorkerFactory(() => new FakeWorker("silent") as unknown as Worker);
    const ctl = new AbortController();
    const pending = layoutGraph(req, { timeoutMs: 60_000, signal: ctl.signal });
    const outcome = pending.then(() => "resolved", (e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 20)); // let it reach the worker race
    ctl.abort();
    expect(await outcome).toBe("AbortError");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(layoutGraph(req, { signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("requestKey", () => {
  it("is stable for the same shape and changes with nodes, sizes or edges", () => {
    const k = requestKey(req);
    expect(requestKey(structuredClone(req))).toBe(k);
    expect(requestKey({ ...req, nodes: req.nodes.slice(1) })).not.toBe(k);
    expect(requestKey({ ...req, nodes: req.nodes.map((n) => (n.id === "a" ? { ...n, height: 41 } : n)) })).not.toBe(k);
    expect(requestKey({ ...req, edges: req.edges.slice(1) })).not.toBe(k);
  });
});
