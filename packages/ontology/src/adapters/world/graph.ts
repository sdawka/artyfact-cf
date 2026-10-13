import type { SourceKind, WorldSnapshot } from "./contracts.ts";
import type { Graph, GraphLink, GraphNode } from "../../graph/graph.ts";
import { instantiateNodes, type Template } from "../../meta/template.ts";
import { duplicateNodes, nodeId, pinOf, worldTemplateToMeta } from "./template.ts";

/** A relation's source kind becomes the link certainty; `observation` is the engine's `observed`. */
const certaintyOf = (kind: SourceKind): string => (kind === "observation" ? "observed" : kind);

/**
 * The snapshot as a canonical graph. Objects keep their ids, kinds, parents and properties; relations become
 * links; Things, rule pack pins, the purpose, the environment, theory claims and the active constraints become
 * `ws.*` nodes; completeness declarations become declarations on `ws:scope:<id>`. The template's prefilled nodes
 * (required relations, scopes, endpoint pairs, required and compiled rule packs, Thing Templates) are included,
 * so the graph evaluates on its own against `worldTemplateToMeta(snapshot)`.
 */
export function worldSnapshotToGraph(snapshot: WorldSnapshot, template: Template = worldTemplateToMeta(snapshot)): Graph {
  const s = snapshot;
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const link = (from: string, rel: string, to: string, certainty?: string) => links.push({ from, rel, to, ...(certainty && { certainty }) });

  nodes.push({
    id: nodeId.snapshot, kind: "ws.snapshot",
    fields: {
      worldId: s.worldId, title: s.title, revisionId: s.revisionId, templateId: s.template.id, templateVersion: s.template.version,
      templateRef: pinOf(s.template), phase: s.phase, stateKind: s.stateKind, activeConstraints: s.activeConstraints,
    },
  });

  nodes.push({ id: nodeId.purpose, kind: "ws.purpose", fields: { statement: s.purpose.statement } });
  for (const b of s.purpose.beneficiaryIds) link(nodeId.purpose, "ws.purposeBeneficiary", b);
  for (const o of s.purpose.outcomeIds) link(nodeId.purpose, "ws.purposeOutcome", o);
  nodes.push({ id: nodeId.environment, kind: "ws.environment", fields: { environmentId: s.environment.id, title: s.environment.title } });
  link(nodeId.environment, "ws.environmentModel", s.environment.id);
  for (const c of s.theory.claims) {
    const id = nodeId.claim(c.id);
    nodes.push({ id, kind: "ws.claim", fields: { id: c.id, title: c.title, sourceKind: c.source.kind, sourceRef: c.source.reference } });
    link(id, "ws.claimOutcome", c.outcomeId);
    for (const x of c.indicatorIds) link(id, "ws.claimIndicator", x);
    for (const x of c.evaluationIds) link(id, "ws.claimEvaluation", x);
  }

  const named = new Set(s.template.incompatibleConstraints.flatMap((c) => [c.left, c.right]));
  nodes.push({ id: nodeId.active, kind: "ws.activeConstraints", fields: Object.fromEntries(s.activeConstraints.filter((c) => named.has(c)).map((c) => [c, true])) });

  for (const t of s.things) {
    const id = nodeId.thing(t.id);
    nodes.push({
      id, kind: "ws.thing",
      fields: {
        id: t.id, thingKind: t.kind, title: t.title, revisionId: t.revisionId, templateId: t.templateRef.id, templateVersion: t.templateRef.version,
        ...t.capabilities,
        ...(t.externalReference && { externalSystem: t.externalReference.system, connectionStatus: t.externalReference.connectionStatus }),
        sourceKind: t.source.kind, sourceRef: t.source.reference,
      },
    });
    link(id, "ws.usesTemplate", nodeId.thingTemplate(t.templateRef.id, t.templateRef.version));
  }

  for (const p of s.rulePacks) nodes.push({ id: nodeId.rulePack(pinOf(p)), kind: "ws.rulePack", fields: { id: p.id, version: p.version, pin: pinOf(p) } });

  for (const o of s.objects) {
    nodes.push({
      id: o.id, kind: o.kind, ...(o.parentId !== undefined && { parent: o.parentId }),
      fields: { "ws.title": o.title, "ws.sourceKind": o.source.kind, "ws.sourceRef": o.source.reference, ...o.properties },
    });
    if (o.thingId !== undefined) link(o.id, "ws.ofThing", nodeId.thing(o.thingId));
  }
  for (const r of s.relations) link(r.fromId, r.kind, r.toId, certaintyOf(r.source.kind));

  nodes.push(
    ...duplicateNodes("objects", s.objects, (o) => o.id),
    ...duplicateNodes("things", s.things, (t) => t.id),
    ...duplicateNodes("relations", s.relations, (r) => r.id),
    ...duplicateNodes("rulePacks", s.rulePacks, (p) => p.id),
    ...duplicateNodes("completeness", s.completeness, (d) => d.scopeId, nodeId.scope),
    ...instantiateNodes(template, nodeId.snapshot),
  );

  return {
    template: template.ref,
    nodes: nodes.map((n) => ({ ...n, fields: n.fields ?? {} })),
    links,
    declarations: s.completeness.map((d) => ({ scope: nodeId.scope(d.scopeId), status: d.status })),
    evidence: [],
  };
}
