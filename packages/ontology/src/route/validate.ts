import { NodeCriterionSchema, RepoPathSchema } from "../genome/node.ts";
import { linkKey, type Graph, type GraphNode } from "../graph/graph.ts";
import { titleOf, type RouteVocabularySource } from "./route.ts";
import type { Op, OpCriterion, OpProblem } from "./types.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Fields every node may carry whatever its kind declares. */
const ALWAYS = new Set(["title", "description"]);

/**
 * Deterministic checks of proposed ops against the graph and template. Errors: a node id that does not exist,
 * an undeclared kind or relation, a relation whose endpoint kinds the template does not allow, an `add` whose title
 * repeats an existing node of the same kind, a criterion that does not fit the `node.yaml` criterion schema, an upsert
 * of a criterion id another node declares, a removal of a criterion the node does not declare, and an `update` with
 * nothing to change (a `files`-only update counts as a change), and an `update` whose `files` entry is not a valid repo path (`op.invalidFile`). Warnings: `op.filesOnTemplateRoot` (files on a `system` node),  an `add` or `update` field the kind does not declare, an `unlink` of a link that is
 * not there, a `link` that already is.
 */
export function validateOps(ops: Op[], template: RouteVocabularySource, g: Graph): OpProblem[] {
  const byId = new Map<string, GraphNode>();
  for (const n of g.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const links = new Set(g.links.map(linkKey));
  const out: OpProblem[] = [];
  const err = (op: number, rule: string, subjects: string[], message: string) => out.push({ level: "error", rule, op, subjects, message });
  const warn = (op: number, rule: string, subjects: string[], message: string) => out.push({ level: "warning", rule, op, subjects, message });
  const known = (i: number, id: string) => { if (byId.has(id)) return true; err(i, "op.unknownNode", [id], `${id} is not a node`); return false; };
  /** Criterion id -> the node declaring it (its `subject` link). */
  const subjectOf = new Map(g.links.filter((l) => l.rel === "subject" && byId.get(l.from)?.kind === "criterion").map((l) => [l.from, l.to]));

  const fields = (i: number, id: string, kind: string, names: string[]) => {
    const declared = template.kinds[kind]?.fields?.map((f) => f.name);
    if (!declared?.length) return;
    for (const f of names) if (!ALWAYS.has(f) && !declared.includes(f)) warn(i, "op.unknownField", [id], `${kind} does not declare field ${f}`);
  };
  /** `node` is the declaring node's id, `undefined` for a node the op adds. */
  const criteria = (i: number, node: string | undefined, list: OpCriterion[]) => {
    const subject = node ?? "(new)";
    for (const c of list) {
      const owner = subjectOf.get(c.id);
      if ("remove" in c && c.remove === true) {
        if (owner !== node || node === undefined) err(i, "op.unknownCriterion", [subject, c.id], `${subject} does not declare criterion ${c.id}`);
        continue;
      }
      const r = NodeCriterionSchema.safeParse(c);
      if (!r.success) err(i, "op.invalidCriterion", [subject, c.id], `criterion ${c.id}: ${r.error.issues.map((x) => (x.path.length ? `${x.path.join(".")}: ` : "") + x.message).join("; ")}`);
      if (owner !== undefined && owner !== node) err(i, "op.duplicateCriterion", [subject, c.id], `criterion ${c.id} is already declared on ${owner}`);
    }
  };

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
        const dup = [...byId.values()].find((n) => n.kind === op.kind && norm(titleOf(n, template)) === norm(op.title));
        if (dup) err(i, "op.duplicateTitle", [dup.id], `${op.kind} "${op.title}" already exists as ${dup.id}`);
        if (kindOk) fields(i, "(new)", op.kind, Object.keys(op.fields ?? {}));
        criteria(i, undefined, op.criteria ?? []);
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
        if (!Object.keys(op.fields ?? {}).length && !op.criteria?.length && op.files === undefined) err(i, "op.emptyUpdate", [op.id], `the update of ${op.id} changes nothing`);
        fields(i, op.id, byId.get(op.id)!.kind, Object.keys(op.fields ?? {}));
        criteria(i, op.id, op.criteria ?? []);
        for (const f of op.files ?? []) if (!RepoPathSchema.safeParse(f).success) err(i, "op.invalidFile", [op.id], `${op.id}: "${f}" is not a repo-relative path`);
        if (op.files?.length && byId.get(op.id)!.kind === "system") warn(i, "op.filesOnTemplateRoot", [op.id], `${op.id} is the System root; files belong on the nodes that realise it`);
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
