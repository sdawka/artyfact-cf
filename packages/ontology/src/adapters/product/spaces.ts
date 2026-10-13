import { parseGraph, type Graph } from "../../graph/graph.ts";
import type { TemplateInput } from "../../meta/schema.ts";
import { spacesChecks } from "./packs.ts";
import { SPEC_ROOT } from "./template.ts";

export const BROPILOT_SPACES = "template.meta.bropilot-spaces@3";

/** Node kinds of the older Bropilot "spaces" schema (bropilot-extract skill), by space. */
export const SPACES_KINDS: Record<string, string[]> = {
  basics: ["name", "purpose", "capability"],
  problem: ["persona", "usecase", "flow", "screen", "constraint", "assumption", "requirement"],
  solution: ["entity", "relationship", "module", "component", "interface", "api", "event", "state", "behaviour", "logic"],
  crosscutting: ["repository", "tests", "observability", "external", "design"],
};
export const SPACES_EDGE_TYPES = ["has", "uses", "triggers", "implements", "depends_on", "extends", "contains", "references"];
const ACYCLIC = new Set(["contains", "extends", "depends_on"]);

const kinds = Object.values(SPACES_KINDS).flat();

/** The spaces vocabulary as a meta@1 template: edges connect any kinds, so it checks cardinality, fields and acyclicity. */
export const bropilotSpaces: TemplateInput = {
  id: "template.meta.bropilot-spaces",
  version: 3,
  meta: 1,
  kinds: {
    spec: {
      fields: [{ name: "app", type: "string" }],
      completeness: { fields: [], children: [{ kind: "name", cardinality: "1" }, { kind: "purpose", cardinality: "1" }], relations: [] },
    },
    ...Object.fromEntries(kinds.map((k) => [k, {
      fields: [
        { name: "title", type: "string", required: true },
        { name: "description", type: "string" },
        { name: "source", type: "string", enum: ["code", "transcript", "code+transcript"] },
        { name: "codeAlignment", type: "string", enum: ["full", "partial", "none", "broken", "roadmap"] },
        { name: "sourceRefs", type: "list" },
      ],
      completeness: {
        fields: [], children: [],
        relations: k === "name" || k === "purpose" ? [{ rel: "has", cardinality: "1..*" }] : [],
      },
    }])),
  },
  relations: Object.fromEntries(SPACES_EDGE_TYPES.map((r) => [r, { from: kinds, to: kinds, ...(ACYCLIC.has(r) && { acyclic: true }) }])),
  rules: [spacesChecks],
};

/** The spafax `bropilot-graph.json` shape: `{ meta, nodes: [{id, kind, title, ...}], edges: [{srcId, dstId, type, label?}] }`. */
export interface SpacesGraphJson {
  meta?: { app?: string; version?: number };
  nodes: Array<{ id: string; kind: string; [k: string]: unknown }>;
  edges?: Array<{ srcId: string; dstId: string; type: string; label?: string }>;
}

/** Maps a spaces graph onto the canonical graph under a synthetic `spec` root. Edge labels are dropped. */
export function spacesGraphToGraph(json: SpacesGraphJson, template = BROPILOT_SPACES): Graph {
  return parseGraph({
    template,
    nodes: [
      { id: SPEC_ROOT, kind: "spec", fields: json.meta?.app ? { app: json.meta.app } : {} },
      ...json.nodes.map(({ id, kind, ...fields }) => ({ id: String(id), kind, parent: SPEC_ROOT, fields })),
    ],
    links: (json.edges ?? []).map((e) => ({ from: String(e.srcId), rel: e.type, to: String(e.dstId) })),
  });
}
