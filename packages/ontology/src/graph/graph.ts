import { z } from "zod";
import { byKey, hashOf } from "../canon.ts";

const name = z.string().min(1);

export const GraphNodeSchema = z.strictObject({
  id: name,
  kind: name,
  parent: name.optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  provisional: z.boolean().optional(),
});

export const GraphLinkSchema = z.strictObject({ from: name, rel: name, to: name, certainty: name.optional() });

export const DeclarationSchema = z.strictObject({ scope: name, status: z.enum(["complete", "incomplete"]) });

export const EvidenceSchema = z.object({ id: name, subject: name, kind: name.default("evidence") }).loose();

export const GraphSchema = z.strictObject({
  template: name,
  nodes: z.array(GraphNodeSchema).default([]),
  links: z.array(GraphLinkSchema).default([]),
  declarations: z.array(DeclarationSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphLink = z.infer<typeof GraphLinkSchema>;
export type Declaration = z.infer<typeof DeclarationSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Graph = z.infer<typeof GraphSchema>;

export const parseGraph = (raw: unknown): Graph => GraphSchema.parse(raw);

export const linkKey = (l: GraphLink): string => JSON.stringify([l.from, l.rel, l.to]);

/** Hash of the graph with nodes, links, declarations and evidence in canonical order. */
export function graphHash(g: Graph): string {
  const sorted = <T>(xs: T[], key: (x: T) => string) => [...xs].sort(byKey(key));
  return hashOf({
    template: g.template,
    nodes: sorted(g.nodes, (n) => JSON.stringify([n.id, n.kind, n.parent ?? ""])),
    links: sorted(g.links, (l) => JSON.stringify([l.from, l.rel, l.to, l.certainty ?? ""])),
    declarations: sorted(g.declarations, (d) => JSON.stringify([d.scope, d.status])),
    evidence: sorted(g.evidence, (e) => JSON.stringify([e.id, e.subject, e.kind])),
  });
}
