import type { TemplateInput, TemplateNode } from "../../meta/schema.ts";
import { memoryStore, type TemplateStore } from "../../meta/template.ts";
import { ARTYFACT_GENOME, criterionFields, criterionLinks, crossLink, hookFields, ontologyFields, templateFields } from "./graph.ts";
import { templateParts } from "./load.ts";
import { artyfactGenome } from "./template.ts";
import { readArtyfactTemplate, templateRef, type Files } from "./templates.ts";

const SELF = "$self";
type Link = NonNullable<TemplateNode["links"]>[number];

/** Converts an artyfact system or thing template into a meta@1 template that extends `template.meta.artyfact-genome@1`. */
export function loadArtyfactTemplate(ref: string, files: Files): TemplateInput {
  const tpl = readArtyfactTemplate(ref, files);
  if (!tpl) throw new Error(`unknown artyfact template ${ref}`);
  if (!/^\d+$/.test(tpl.version)) throw new Error(`template ${ref}: version ${tpl.version} is not an integer`);
  const parts = templateParts(tpl, tpl.kind, SELF);
  const out = (l: { from: string; rel: string; to: string; certainty?: string }): Link =>
    ({ rel: l.rel, to: l.to, ...(l.certainty !== undefined && { certainty: l.certainty }) });
  const nodes = [
    { id: templateRef(tpl), kind: "template", fields: templateFields(tpl) },
    ...parts.nodes.map((n) => {
      const links = [...n.refines.map((to) => ({ from: n.id, rel: "refines", to })), ...n.links.map((l) => crossLink(n.id, l))];
      const inbound = links.find((l) => l.from !== n.id);
      if (inbound) throw new Error(`template ${ref}: node ${n.id} has an inbound ${inbound.rel} link, which a prefilled node cannot carry`);
      return { id: n.id, kind: n.kind, parent: n.parent, fields: ontologyFields(n), ...(n.provisional && { provisional: true }), ...(links.length && { links: links.map(out) }) };
    }),
    ...parts.criteria.map((c) => ({ id: c.id, kind: "criterion", fields: criterionFields(c), links: criterionLinks(c).map(out) })),
    ...parts.hooks.map((h) => ({ id: h.id, kind: "hook", fields: hookFields(h) })),
  ];
  return {
    id: tpl.id,
    version: Number(tpl.version),
    meta: 1,
    extends: ARTYFACT_GENOME,
    criteria: tpl.criteria.map((c) => ({
      id: c.id, owner: c.ownerKind, subject: c.subjectKind, severity: c.severity, description: c.claim, gates: c.gates, hooks: c.hooks,
    })),
    nodes,
  };
}

/** A meta@1 store holding the base template and every artyfact template in `files` that `get` is asked for. */
export function artyfactMetaStore(files: Files = {}): TemplateStore {
  const base = memoryStore([artyfactGenome]);
  return { get: (ref) => (ref === ARTYFACT_GENOME ? base.get(ref) : readArtyfactTemplate(ref, files) && loadArtyfactTemplate(ref, files)) };
}
