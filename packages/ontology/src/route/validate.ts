import { linkKey, type Graph, type GraphNode } from "../graph/graph.ts";
import { titleOf, type RouteVocabularySource } from "./route.ts";
import type { Op, OpProblem } from "./types.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Fields every node may carry whatever its kind declares. */
const ALWAYS = new Set(["title", "description"]);

/**
 * Deterministic checks of proposed ops against the graph and template. Errors: a node id that does not exist,
 * an undeclared kind or relation, a relation whose endpoint kinds the template does not allow, an `add` whose title
 * repeats an existing node of the same kind. Warnings: an `update` field the kind does not declare, an `unlink` of a
 * link that is not there, a `link` that already is.
 */
export function validateOps(ops: Op[], template: RouteVocabularySource, g: Graph): OpProblem[] {
  const byId = new Map<string, GraphNode>();
  for (const n of g.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const links = new Set(g.links.map(linkKey));
  const out: OpProblem[] = [];
  const err = (op: number, rule: string, subjects: string[], message: string) => out.push({ level: "error", rule, op, subjects, message });
  const warn = (op: number, rule: string, subjects: string[], message: string) => out.push({ level: "warning", rule, op, subjects, message });
  const known = (i: number, id: string) => { if (byId.has(id)) return true; err(i, "op.unknownNode", [id], `${id} is not a node`); return false; };

  /** `from` and `to` are kinds; `fromId`/`toId` name the ends for the message. */
  const relation = (i: number, rel: string, from: string, to: string, ends: [string, string]) => {
    const r = template.relations[rel];
    if (!r) { err(i, "op.unknownRelation", ends, `relation ${rel} is not declared`); return; }
    if (!r.from.includes(from) || !r.to.includes(to)) err(i, "op.relationEndpoint", ends, `${rel} does not go from ${from} to ${to}`);
  };

  ops.forEach((op, i) => {
    switch (op.op) {
      case "add": {
        const kindOk = op.kind in template.kinds;
        if (!kindOk) err(i, "op.unknownKind", [], `kind ${op.kind} is not declared`);
        if (op.parent !== undefined) known(i, op.parent);
        const dup = [...byId.values()].find((n) => n.kind === op.kind && norm(titleOf(n)) === norm(op.title));
        if (dup) err(i, "op.duplicateTitle", [dup.id], `${op.kind} "${op.title}" already exists as ${dup.id}`);
        for (const l of op.links ?? []) {
          const other = l.to ?? l.from;
          if (other === undefined || !known(i, other) || !kindOk) continue;
          const ok = byId.get(other)!.kind;
          if (l.to !== undefined) relation(i, l.rel, op.kind, ok, ["(new)", other]);
          else relation(i, l.rel, ok, op.kind, [other, "(new)"]);
        }
        break;
      }
      case "update": {
        if (!known(i, op.id)) break;
        const n = byId.get(op.id)!;
        const declared = template.kinds[n.kind]?.fields?.map((f) => f.name);
        if (!declared?.length) break;
        for (const f of Object.keys(op.fields)) {
          if (!ALWAYS.has(f) && !declared.includes(f)) warn(i, "op.unknownField", [op.id], `${n.kind} does not declare field ${f}`);
        }
        break;
      }
      case "remove":
        known(i, op.id);
        break;
      case "link":
      case "unlink": {
        const a = known(i, op.from), b = known(i, op.to);
        if (!a || !b) break;
        relation(i, op.rel, byId.get(op.from)!.kind, byId.get(op.to)!.kind, [op.from, op.to]);
        const exists = links.has(linkKey({ from: op.from, rel: op.rel, to: op.to }));
        if (op.op === "unlink" && !exists) warn(i, "op.missingLink", [op.from, op.to], `${op.from} ${op.rel} ${op.to} is not a link`);
        if (op.op === "link" && exists) warn(i, "op.duplicateLink", [op.from, op.to], `${op.from} ${op.rel} ${op.to} already exists`);
        break;
      }
    }
  });
  return out;
}
