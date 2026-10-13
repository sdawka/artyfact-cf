import * as schema from "./schema.ts";
import { sha256 } from "./sha256.ts";

export interface PartResolver {
  get(ref: schema.PartRef): schema.PartPackage | undefined;
}

export interface ComposeOptions {
  maxDepth?: number;
  maxContributions?: number;
  maxOutputs?: number;
}

export class PartCompositionError extends Error {
  readonly code: "unknown-part" | "cycle" | "input" | "collision" | "declaration" | "integrity" | "limit";
  constructor(message: string, code: PartCompositionError["code"]) {
    super(message);
    this.name = "PartCompositionError";
    this.code = code;
  }
}

type Item = schema.PartOutputMapping & { content?: string };
type Expanded = {
  items: Item[];
  packages: schema.CompositionProvenance["packages"];
  inputs: schema.CompositionProvenance["inputs"];
  commands: schema.SavedPartCommand[];
};

const key = (kind: schema.PartContentKind, path: string) => `${kind}\0${path}`;
const qualify = (prefix: string, id: string) => (prefix ? `${prefix}/${id}` : id);
const own = <T>(value: Record<string, T>, name: string) => Object.prototype.hasOwnProperty.call(value, name);

function interpolate(text: string, values: Record<string, schema.PartInputValue>): string {
  return text.replace(/\$\{([A-Za-z][\w.-]*)\}/g, (whole, name: string) => own(values, name) ? String(values[name] ?? "") : whole);
}

function resolveInputs(part: schema.PartPackage, supplied: Record<string, schema.PartInputValue>, contribution: string) {
  const definitions = new Map(part.inputs.map((input) => [input.name, input] as const));
  for (const name of Object.keys(supplied)) {
    if (!definitions.has(name)) throw new PartCompositionError(`${contribution}: unknown input ${name}`, "input");
  }
  const values: Record<string, schema.PartInputValue> = {};
  for (const input of part.inputs) {
    if (own(supplied, input.name)) values[input.name] = supplied[input.name];
    else if (input.default !== undefined) values[input.name] = input.default;
    else if (input.required) throw new PartCompositionError(`${contribution}: required input ${input.name} was not supplied`, "input");
  }
  return values;
}

function selectItems(items: Item[], contribution: schema.PartContribution): Item[] {
  const excluded: Item[] = [];
  const retained: Item[] = [];
  for (const item of items) {
    const selector = item.kind === "file" ? contribution.files : contribution.model;
    const masks = item.kind === "file" ? contribution.mask.files : contribution.mask.model;
    const selected = selector?.include === undefined || selector.include.includes(item.path);
    const masked = masks.includes(item.path);
    if (!selected || masked) {
      excluded.push({ ...item, disposition: "excluded", content: undefined });
      continue;
    }
    const renamed = selector?.rename[item.path];
    retained.push({
      ...item,
      path: renamed ?? item.path,
      disposition: renamed === undefined ? item.disposition : "adapted",
    });
  }
  return [...retained, ...excluded];
}

interface ComposeState { contributions: number; outputs: number; limits: Required<ComposeOptions> }

function expandRecipe(recipe: schema.PartRecipe, resolver: PartResolver, prefix: string, stack: string[], state: ComposeState): Expanded {
  if (stack.length > state.limits.maxDepth) throw new PartCompositionError(`Part nesting depth exceeds ${state.limits.maxDepth}`, "limit");
  const ids = recipe.contributions.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new PartCompositionError(`${recipe.id}: contribution ids must be unique`, "declaration");

  const output = new Map<string, Item>();
  const history: Item[] = [];
  const packages: Expanded["packages"] = [];
  const inputs: Expanded["inputs"] = [];
  const commands: Expanded["commands"] = [];

  for (const contribution of recipe.contributions) {
    state.contributions++;
    if (state.contributions > state.limits.maxContributions) throw new PartCompositionError(`Part contribution limit ${state.limits.maxContributions} exceeded`, "limit");
    const contributionId = qualify(prefix, contribution.id);
    const coordinate = `${contribution.part.id}@${contribution.part.version}`;
    if (stack.includes(coordinate)) throw new PartCompositionError(`Part cycle: ${[...stack, coordinate].join(" -> ")}`, "cycle");
    const unresolved = resolver.get(contribution.part);
    if (!unresolved) throw new PartCompositionError(`${contributionId}: unknown Part ${coordinate}`, "unknown-part");
    const part = schema.PartPackage.parse(unresolved);
    if (part.id !== contribution.part.id || part.version !== contribution.part.version) {
      throw new PartCompositionError(`${contributionId}: resolver returned ${part.id}@${part.version} for ${coordinate}`, "unknown-part");
    }
    if (part.digest !== undefined && part.digest !== partDigest(part)) {
      throw new PartCompositionError(`${contributionId}: digest mismatch for ${coordinate}`, "integrity");
    }
    const values = resolveInputs(part, contribution.inputs, contributionId);
    packages.push({ contribution: contributionId, part: contribution.part, digest: part.digest });
    inputs.push({ contribution: contributionId, values });

    const direct: Item[] = [];
    for (const [path, content] of Object.entries(part.payload.model)) {
      const adapted = interpolate(content, values);
      direct.push({ kind: "model", path, sourcePath: path, contribution: contributionId, part: contribution.part, content: adapted, disposition: adapted === content ? "retained" : "adapted" });
    }
    for (const [path, content] of Object.entries(part.payload.files)) {
      const adapted = interpolate(content, values);
      direct.push({ kind: "file", path, sourcePath: path, contribution: contributionId, part: contribution.part, content: adapted, disposition: adapted === content ? "retained" : "adapted" });
    }
    state.outputs += direct.length;
    if (state.outputs > state.limits.maxOutputs) throw new PartCompositionError(`Part output limit ${state.limits.maxOutputs} exceeded`, "limit");
    let nested: Expanded = { items: [], packages: [], inputs: [], commands: [] };
    if (part.recipe) nested = expandRecipe(part.recipe, resolver, contributionId, [...stack, coordinate], state);
    packages.push(...nested.packages);
    inputs.push(...nested.inputs);
    commands.push(...nested.commands, ...part.commands.map((command) => ({ ...command, contribution: contributionId })));

    const selected = selectItems([...direct, ...nested.items], contribution);
    const active = selected.filter((item) => item.disposition !== "excluded" && item.content !== undefined);
    history.push(...selected.filter((item) => item.disposition === "excluded" || item.content === undefined));
    const usedDeclarations = new Set<string>();
    for (const item of active) {
      const itemKey = key(item.kind, item.path);
      const existing = output.get(itemKey);
      if (!existing) {
        output.set(itemKey, item);
        continue;
      }
      const replacement = contribution.replacements.find((r) => r.kind === item.kind && r.path === item.path && qualify(prefix, r.contribution) === existing.contribution);
      if (replacement) {
        usedDeclarations.add(`replace:${replacement.kind}:${replacement.path}:${replacement.contribution}`);
        history.push({ ...existing, disposition: "replaced", by: contributionId, content: undefined });
        output.set(itemKey, item);
        continue;
      }
      const combination = contribution.combinations.find((r) => r.kind === item.kind && r.path === item.path && qualify(prefix, r.contribution) === existing.contribution);
      if (combination) {
        usedDeclarations.add(`combine:${combination.kind}:${combination.path}:${combination.contribution}`);
        const first = combination.strategy === "append" ? existing.content! : item.content!;
        const second = combination.strategy === "append" ? item.content! : existing.content!;
        history.push({ ...existing, disposition: "combined", by: contributionId, content: undefined });
        output.set(itemKey, { ...item, content: `${first}${combination.separator}${second}`, disposition: "combined", by: existing.contribution });
        continue;
      }
      throw new PartCompositionError(`${item.kind} collision at ${item.path} between ${existing.contribution} and ${item.contribution}`, "collision");
    }
    for (const replacement of contribution.replacements) {
      const declaration = `replace:${replacement.kind}:${replacement.path}:${replacement.contribution}`;
      if (!usedDeclarations.has(declaration)) throw new PartCompositionError(`${contributionId}: replacement for ${replacement.contribution} ${replacement.kind} ${replacement.path} matched no collision`, "declaration");
    }
    for (const combination of contribution.combinations) {
      const declaration = `combine:${combination.kind}:${combination.path}:${combination.contribution}`;
      if (!usedDeclarations.has(declaration)) throw new PartCompositionError(`${contributionId}: combination with ${combination.contribution} ${combination.kind} ${combination.path} matched no collision`, "declaration");
    }
  }
  commands.push(...recipe.commands.map((command) => ({ ...command, contribution: prefix || "@recipe" })));
  return { items: [...output.values(), ...history], packages, inputs, commands };
}

/** Pure deterministic composition. Commands are returned as inert data and are never executed here. */
export function composeParts(recipeInput: schema.PartRecipe, resolver: PartResolver, options: ComposeOptions = {}): schema.SavedComposition {
  const recipe = schema.PartRecipe.parse(recipeInput);
  const limits = {
    maxDepth: options.maxDepth ?? 32,
    maxContributions: options.maxContributions ?? 1_000,
    maxOutputs: options.maxOutputs ?? 10_000,
  };
  if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit < 1)) throw new PartCompositionError("composition limits must be positive integers", "limit");
  const expanded = expandRecipe(recipe, resolver, "", [], { contributions: 0, outputs: 0, limits });
  const model: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const item of expanded.items) {
    if (item.disposition === "excluded" || item.disposition === "replaced" || item.content === undefined) continue;
    (item.kind === "file" ? files : model)[item.path] = item.content;
  }
  return schema.SavedComposition.parse({
    version: 1,
    recipe,
    model,
    files,
    provenance: {
      recipe: recipe.id,
      packages: expanded.packages,
      inputs: expanded.inputs,
      outputs: expanded.items.map(({ content: _content, ...mapping }) => mapping),
    },
    commands: expanded.commands,
  });
}

function selectedPaths(all: Record<string, string>, selected: string[] | undefined) {
  return selected === undefined ? Object.keys(all) : selected.filter((path) => own(all, path));
}

/** Copies a generalized package from a revision snapshot without mutating the supplied source. */
export function extractPart(requestInput: schema.ExtractionRequest): schema.ExtractionResult {
  const request = schema.ExtractionRequest.parse(requestInput);
  const payload: schema.PartPayload = { model: {}, files: {} };
  const outputs: schema.PartOutputMapping[] = [];
  const inputs = new Map<string, schema.PartInputDefinition>();
  for (const kind of ["model", "file"] as const) {
    const source = kind === "model" ? request.source.model : request.source.files;
    const selected = kind === "model" ? request.select.model : request.select.files;
    const masks = kind === "model" ? request.mask.model : request.mask.files;
    const target = kind === "model" ? payload.model : payload.files;
    for (const path of selectedPaths(source, selected)) {
      if (masks.includes(path)) {
        outputs.push({ kind, path, sourcePath: path, contribution: "extraction", disposition: "excluded" });
        continue;
      }
      let content = source[path];
      let adapted = false;
      for (const generalization of request.generalize.filter((g) => g.kind === kind && g.path === path)) {
        if (!content.includes(generalization.value)) throw new PartCompositionError(`${kind} ${path}: generalization value was not found`, "declaration");
        content = content.split(generalization.value).join(`\${${generalization.input}}`);
        adapted = true;
        inputs.set(generalization.input, { name: generalization.input, default: generalization.default, required: generalization.default === undefined });
      }
      target[path] = content;
      outputs.push({ kind, path, sourcePath: path, contribution: "extraction", disposition: adapted ? "adapted" : "retained" });
    }
    for (const path of masks) {
      if (own(source, path) && !outputs.some((o) => o.kind === kind && o.path === path)) outputs.push({ kind, path, sourcePath: path, contribution: "extraction", disposition: "excluded" });
    }
  }
  const part = schema.PartPackage.parse({ ...request.package, inputs: [...inputs.values()], payload });
  return schema.ExtractionResult.parse({ part, sourceRevision: request.source.revision, provenance: { outputs } });
}

function upgradeKind(kind: schema.PartContentKind, baseline: Record<string, string>, current: Record<string, string>, next: Record<string, string>, conflicts: schema.UpgradeConflict[]) {
  const result: Record<string, string> = {};
  const paths = [...new Set([...Object.keys(baseline), ...Object.keys(current), ...Object.keys(next)])].sort();
  for (const path of paths) {
    const b = own(baseline, path) ? baseline[path] : undefined;
    const c = own(current, path) ? current[path] : undefined;
    const n = own(next, path) ? next[path] : undefined;
    let chosen: string | undefined;
    if (c === b) chosen = n;
    else if (n === b || c === n) chosen = c;
    else {
      chosen = c;
      conflicts.push({ kind, path, baseline: b, current: c, next: n });
    }
    if (chosen !== undefined) result[path] = chosen;
  }
  return result;
}

/** Three-way upgrade: unchanged generated content advances, customization is retained, divergence is reported. */
export function upgradeComposition(requestInput: schema.UpgradeRequest): schema.UpgradeResult {
  const request = schema.UpgradeRequest.parse(requestInput);
  const conflicts: schema.UpgradeConflict[] = [];
  return schema.UpgradeResult.parse({
    result: {
      model: upgradeKind("model", request.baseline.model, request.current.model, request.next.model, conflicts),
      files: upgradeKind("file", request.baseline.files, request.current.files, request.next.files, conflicts),
    },
    conflicts,
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((k) => record[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Digest of immutable package content. Publication state and the digest field itself are excluded. */
export function partDigest(partInput: schema.PartPackage): string {
  const { digest: _digest, published: _published, ...content } = schema.PartPackage.parse(partInput);
  return `sha256:${sha256(canonical(content))}`;
}
