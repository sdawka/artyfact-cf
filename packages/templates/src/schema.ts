// TODO(w0-model): local copy of the Template schema from docs/design/model.md A.2.
// Replace with `import { schema } from "@artyfact/model"` once that package merges, then delete this file.
import { z } from "zod";

const AnyId = z.string().min(1);
const Gate = z.enum(["submission", "candidate", "selection", "promotion", "deployment", "outcome"]);
const NodeKind = z.enum([
  "system", "thing", "section", "screen", "component", "affordance", "route", "entity", "field",
  "operation", "policy", "binding", "grouping", "external", "purpose", "claim", "requirement",
]);
const Certainty = z.enum(["declared", "assumed", "hypothesis", "proposed", "observed", "derived"]);
const Relation = z.enum([
  "contains", "serves", "invokes", "governs", "reads", "writes", "storedIn", "refines", "realizes",
  "dependsOn", "satisfies", "measures", "affects", "inherits", "triggers", "references",
]);

const CrossLink = z.object({
  rel: Relation,
  to: AnyId,
  direction: z.enum(["out", "in"]).default("out"),
  certainty: Certainty.default("declared"),
  label: z.string().optional(),
});

export const OntologyNode = z.object({
  id: AnyId,
  kind: NodeKind,
  name: z.string(),
  parent: AnyId.optional(),
  owningThing: AnyId.optional(),
  revision: z.number().int().default(1),
  description: z.string().optional(),
  refines: z.array(AnyId).default([]),
  links: z.array(CrossLink).default([]),
  route: z.string().optional(),
  cardinality: z.string().optional(),
  states: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  actor: z.string().optional(),
  trigger: z.string().optional(),
  preconditions: z.array(z.string()).default([]),
  effects: z.array(z.string()).default([]),
  failure: z.array(z.string()).default([]),
  fields: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean().default(false) })).default([]),
  invariants: z.array(z.string()).default([]),
  provisional: z.boolean().default(false),
  fromTemplate: z.string().optional(),
});

export const Criterion = z.object({
  id: AnyId,
  version: z.number().int().default(1),
  title: z.string(),
  claim: z.string(),
  ownerKind: z.enum(["system", "thing"]),
  ownerId: AnyId,
  subjectKind: NodeKind,
  subjectId: AnyId,
  targetKind: z.enum(["model", "artifact", "runtime", "observation"]),
  sourceRefs: z.array(AnyId).default([]),
  refines: z.array(AnyId).default([]),
  satisfies: z.array(AnyId).default([]),
  severity: z.enum(["hard", "soft", "advisory"]).default("hard"),
  gates: z.array(Gate),
  applicableWhen: z.string().optional(),
  deferred: z.boolean().default(false),
  hooks: z.array(z.string()).default([]),
  fromTemplate: z.string().optional(),
});

export const AssayHook = z.object({
  id: AnyId,
  version: z.number().int().default(1),
  assay: z.string(),
  criteria: z.array(AnyId),
  tier: z.enum(["basic", "execution", "semantic"]),
  engine: z.enum(["manifest", "diff", "model-rules", "vitest", "browser", "http", "llm"]),
  targetKind: z.enum(["model", "artifact", "runtime", "observation"]),
  triggers: z.array(Gate),
  inputs: z.record(z.string(), z.string()).default({}),
  verdictMapping: z.string().optional(),
  timeoutMs: z.number().int().default(60000),
  costTier: z.enum(["free", "cheap", "expensive"]).default("free"),
  binding: z.enum(["defined", "implementation-missing", "bound"]).default("defined"),
  fromTemplate: z.string().optional(),
});

export const Template = z.object({
  id: z.string().regex(/^template\.[\w.-]+$/),
  kind: z.enum(["system", "thing"]),
  version: z.string(),
  name: z.string(),
  description: z.string().optional(),
  sections: z.array(AnyId).default([]),
  nodes: z.array(OntologyNode).default([]),
  criteria: z.array(Criterion).default([]),
  hooks: z.array(AssayHook).default([]),
  scaffold: z.object({ repo: z.string().optional(), path: z.string().optional() }).optional(),
  sourceMapDefaults: z.array(z.object({ glob: z.string(), nodes: z.array(AnyId) })).optional(),
  requires: z.array(z.string()).default([]),
});
export type Template = z.infer<typeof Template>;
