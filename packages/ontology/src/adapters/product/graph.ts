import { parseGraph, type Graph, type GraphLink, type GraphNode } from "../../graph/graph.ts";
import { SPEC_ROOT } from "./template.ts";

export const PRODUCT_SPEC = "template.meta.product-spec@1";

/** A uip project graph or lfp `graph.json`: `{ nodes: [{id, kind, title, status, source, props}], edges: [{id, src, dst, type}] }`. */
export interface ProductGraphJson {
  nodes: Array<{ id: string; kind: string; title?: string; description?: string; status?: string; source?: Record<string, unknown>; props?: Record<string, unknown>; [k: string]: unknown }>;
  edges?: Array<{ id?: string; src?: string; dst?: string; from?: string; to?: string; type: string; status?: string }>;
}

export interface ProductLoadOptions {
  /** Template ref the graph names; defaults to `template.meta.product-spec@1`. */
  template?: string;
  /** Title of the synthetic spec root. */
  title?: string;
  /** Also set the engine's `provisional` flag on nodes whose status is not `committed`; that makes them `missing`. */
  provisionalFlag?: boolean;
}

const RESERVED = new Set(["id", "kind", "source", "props", "v"]);

/** Flattens a product node into the canonical shape: `source.<key>`, `props.<key>`, everything else by name. `v` is dropped. */
function toNode(n: ProductGraphJson["nodes"][number], opts: ProductLoadOptions): GraphNode {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) if (!RESERVED.has(k) && v !== undefined) fields[k] = v;
  for (const [k, v] of Object.entries(n.source ?? {})) fields[`source.${k}`] = v;
  for (const [k, v] of Object.entries(n.props ?? {})) fields[`props.${k}`] = v;
  const uncommitted = n.status !== undefined && n.status !== "committed";
  return { id: n.id, kind: n.kind, parent: SPEC_ROOT, fields, ...(opts.provisionalFlag && uncommitted && { provisional: true }) };
}

/** Edge `type` becomes the relation; a status other than `committed` becomes the link's certainty. Edge ids are dropped. */
function toLink(e: NonNullable<ProductGraphJson["edges"]>[number]): GraphLink {
  const from = e.src ?? e.from, to = e.dst ?? e.to;
  if (from === undefined || to === undefined) throw new Error(`product edge ${e.id ?? e.type} has no src/dst`);
  return { from, rel: e.type, to, ...(e.status !== undefined && e.status !== "committed" && { certainty: e.status }) };
}

/** Maps a uip/lfp product graph onto the canonical graph, under a synthetic `spec` root. */
export function productGraphToGraph(json: ProductGraphJson, opts: ProductLoadOptions = {}): Graph {
  return parseGraph({
    template: opts.template ?? PRODUCT_SPEC,
    nodes: [{ id: SPEC_ROOT, kind: "spec", fields: opts.title ? { title: opts.title } : {} }, ...json.nodes.map((n) => toNode(n, opts))],
    links: (json.edges ?? []).map(toLink),
  });
}
