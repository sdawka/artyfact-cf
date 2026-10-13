import { z } from "zod";

/**
 * Genome v2: one directory per node, each holding a `node.yaml` that is the node's whole definition. Directory
 * nesting is containment (the enclosing directory's node is the parent); the template's `parents` decide which
 * nestings are legal. Change records stay flat under `evolutions/`. Design: `docs/design/ontology.md`.
 */

/** The file that defines a node; at the Genome root it defines the System and marks the tree layout. */
export const NODE_FILE = "node.yaml";
/** Root file of the v1 (by-concern) layout. */
export const V1_ROOT_FILE = "system.yaml";
/** Flat change records; never a node directory. */
export const EVOLUTIONS_DIR = "evolutions";

export const GENOME_FORMATS = ["v1", "v2"] as const;
export type GenomeFormat = (typeof GENOME_FORMATS)[number];

const name = z.string().min(1);
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");

/**
 * The layout of a Genome from its root files: `node.yaml` is v2, `system.yaml` is v1. Both at once, or neither, is
 * an error (a half-converted or foreign tree), so a caller never guesses.
 */
export function detectGenomeFormat(paths: Iterable<string>): GenomeFormat {
  let v1 = false, v2 = false;
  for (const p of paths) {
    const n = norm(p);
    if (n === NODE_FILE) v2 = true;
    else if (n === V1_ROOT_FILE) v1 = true;
  }
  if (v1 && v2) throw new Error(`genome has both ${NODE_FILE} and ${V1_ROOT_FILE} at its root`);
  if (!v1 && !v2) throw new Error(`genome has neither ${NODE_FILE} nor ${V1_ROOT_FILE} at its root`);
  return v2 ? "v2" : "v1";
}

/** A node directory name: letters, digits, `.`, `_` and `-`, not starting with `.` or `-`. */
export const NODE_SLUG = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
/** Directory names a node may not take at the Genome root. */
export const RESERVED_ROOT_DIRS: readonly string[] = [EVOLUTIONS_DIR];

export const isNodeSlug = (s: string): boolean => NODE_SLUG.test(s) && s.length <= 120;

/**
 * The directory name a writer gives a new node: its id when that is a valid slug, else the id with every run of
 * other characters replaced by `-`. The id in `node.yaml` stays authoritative; a slug only has to be unique among
 * its siblings, and renaming a directory never changes the node's identity.
 */
export function slugOf(id: string): string {
  if (isNodeSlug(id)) return id;
  const s = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/-+$/, "").slice(0, 120);
  return s || "node";
}

/** A pinned template reference: `template.<kind>.<name>@<version>`, the engine's `refOf` form. */
export const TemplateRefSchema = z.string().regex(/^template\.[\w.-]+@[\w.-]+$/, "expected template.<kind>.<name>@<version>");

/**
 * Placeholders a template's kind-level `files` default may use; the source map substitutes the node's id and its
 * directory slug.
 */
export const FILE_PLACEHOLDERS = ["{id}", "{slug}"] as const;

/** A repo-relative POSIX path or glob: no leading `/`, no `..` segment, no backslash. */
export const RepoPathSchema = z.string().min(1).refine(
  (p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes(".."),
  "expected a repo-relative path without .. segments",
);

/** How sure the author is of a link; the same values as the v1 model's `Certainty`. */
export const CERTAINTIES = ["declared", "assumed", "hypothesis", "proposed", "observed", "derived"] as const;

/** An outgoing link of the node: `from` is the node itself. Containment is never a link; it is the directory tree. */
export const NodeLinkSchema = z.strictObject({
  rel: name,
  to: name,
  /** Absent means `declared`. */
  certainty: z.enum(CERTAINTIES).optional(),
});

export const GATES = ["submission", "candidate", "selection", "promotion", "deployment", "outcome"] as const;
export const CRITERION_SEVERITIES = ["hard", "soft", "advisory"] as const;
/** What a criterion is checked against: the Genome itself, the built app, the running app, or observed outcomes. */
export const CRITERION_TARGETS = ["model", "artifact", "runtime", "observation"] as const;
export const HOOK_ENGINES = ["manifest", "diff", "model-rules", "system-one", "vitest", "browser", "http", "llm"] as const;
export const HOOK_TIERS = ["basic", "execution", "semantic"] as const;

/**
 * An assay hook declared inline under the criterion it checks. The v1 `AssayHook` without `criteria` (implied by
 * nesting) and with `target` for `targetKind`.
 */
export const NodeHookSchema = z.strictObject({
  id: name,
  version: z.number().int().optional(),
  assay: z.string(),
  tier: z.enum(HOOK_TIERS),
  engine: z.enum(HOOK_ENGINES),
  /** Absent: the criterion's target. */
  target: z.enum(CRITERION_TARGETS).optional(),
  triggers: z.array(z.enum(GATES)),
  inputs: z.record(z.string(), z.string()).optional(),
  verdictMapping: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().optional(),
  costTier: z.enum(["free", "cheap", "expensive"]).optional(),
  binding: z.enum(["defined", "implementation-missing", "bound"]).optional(),
  fromTemplate: TemplateRefSchema.optional(),
});

/**
 * What must hold for the node it is declared on (its subject). The owner is the nearest enclosing node that
 * instantiates a template (a Thing, else the System). Ids stay globally unique (`C.…`) so evaluations, the Changelog
 * and Evolution `acceptanceCriteria` keep referencing them. A hook is declared inline once; another criterion that
 * shares it names its id.
 */
export const NodeCriterionSchema = z.strictObject({
  id: z.string().regex(/^C\./, "criterion ids start with C."),
  version: z.number().int().optional(),
  title: z.string().optional(),
  claim: z.string().min(1),
  /** Absent: `hard`. */
  severity: z.enum(CRITERION_SEVERITIES).optional(),
  /** Absent: `model`. */
  target: z.enum(CRITERION_TARGETS).optional(),
  /** The gates the criterion is evaluated at. */
  gates: z.array(z.enum(GATES)).optional(),
  applicableWhen: z.string().optional(),
  deferred: z.boolean().optional(),
  refines: z.array(name).optional(),
  satisfies: z.array(name).optional(),
  sourceRefs: z.array(name).optional(),
  hooks: z.array(z.union([name, NodeHookSchema])).optional(),
  fromTemplate: TemplateRefSchema.optional(),
});

/**
 * `node.yaml`. Optional collections are left out when empty, so a parse keeps the file's shape and a writer that
 * round-trips a node does not grow keys. `fields` holds the kind's declared fields (`title`, `description`, …).
 */
export const NodeFileSchema = z.strictObject({
  id: name,
  kind: name,
  /** The template this node instantiates: the System at the root, and every Thing. */
  template: TemplateRefSchema.optional(),
  /** Repo-relative prefix for the `files` of this node and every node below it (a Thing's app root). */
  root: RepoPathSchema.optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  links: z.array(NodeLinkSchema).optional(),
  /** Source globs that realise this node, relative to the nearest `root` above (or the repo root). */
  files: z.array(RepoPathSchema).optional(),
  criteria: z.array(NodeCriterionSchema).optional(),
  provisional: z.boolean().optional(),
});

export type NodeLink = z.infer<typeof NodeLinkSchema>;
export type NodeHook = z.infer<typeof NodeHookSchema>;
export type NodeCriterion = z.infer<typeof NodeCriterionSchema>;
export type NodeFile = z.infer<typeof NodeFileSchema>;
export type Gate = (typeof GATES)[number];
export type CriterionSeverity = (typeof CRITERION_SEVERITIES)[number];
export type CriterionTarget = (typeof CRITERION_TARGETS)[number];
export type LinkCertainty = (typeof CERTAINTIES)[number];

export const parseNodeFile = (raw: unknown): NodeFile => NodeFileSchema.parse(raw);
