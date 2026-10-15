import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readDir } from "@artyfact/ontology/artyfact/node";
import { convertV1 } from "@artyfact/ontology/codec/v1";
import { isLegacyGenome } from "@artyfact/ontology/genome";
import { CliError } from "./git.ts";
import type { Io } from "./main.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Templates shipped beside the published bundle (dist/templates), else the monorepo checkout's packages/templates. */
function defaultTemplates(root: string | undefined): string {
  const bundled = join(here, "templates");
  return root === undefined && existsSync(bundled) ? bundled : join(root ?? resolve(here, "../../.."), "packages", "templates");
}

/**
 * `artyfact convert-genome <src> <dst> [--templates dir] [--source-map file]`: writes the v2 node tree for the v1
 * Genome in `src` into `dst`, which must not exist or be empty. Only the Genome's YAML is read; `src` is never changed.
 * Templates come from `--templates`, else the published package's bundled copy, else the checkout's `packages/templates`. `--source-map` is the app repo's v1
 * `source-map.yaml`: its globs become the named nodes' `files`.
 */
export function convertGenomeCommand(argv: string[], io: Pick<Io, "cwd" | "out" | "root">): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { templates: { type: "string" }, "source-map": { type: "string" } }, allowPositionals: true });
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const args = parsed.positionals;
  if (args.length !== 2) throw new CliError("usage: artyfact convert-genome <src> <dst> [--templates dir] [--source-map file]");
  const tplDir = parsed.values.templates ? resolve(io.cwd, parsed.values.templates) : defaultTemplates(io.root);
  if (!existsSync(tplDir)) throw new CliError(`templates directory ${tplDir} not found; pass --templates`);
  const src = resolve(io.cwd, args[0]!), dst = resolve(io.cwd, args[1]!);
  if (!existsSync(src) || !lstatSync(src).isDirectory()) throw new CliError(`${args[0]} is not a directory`);
  const files = readDir(src);
  if (!isLegacyGenome(Object.keys(files))) throw new CliError(`${args[0]} is not a v1 Genome (no system.yaml, or it already has a root node.yaml)`);
  if (existsSync(dst) && (!lstatSync(dst).isDirectory() || readdirSync(dst).length)) throw new CliError(`${args[1]} exists and is not an empty directory`);
  const mapPath = parsed.values["source-map"] === undefined ? undefined : resolve(io.cwd, parsed.values["source-map"]);
  if (mapPath && !existsSync(mapPath)) throw new CliError(`source map ${parsed.values["source-map"]} not found`);
  let tree: Map<string, string>;
  try {
    tree = convertV1(files, readDir(tplDir), { sourceMap: mapPath && readFileSync(mapPath, "utf8") });
  } catch (e) {
    throw new CliError(`cannot convert ${args[0]}: ${(e as Error).message}`);
  }
  for (const [path, text] of tree) {
    const file = join(dst, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { flag: "wx" });
  }
  const nodes = [...tree.keys()].filter((p) => p === "node.yaml" || p.endsWith("/node.yaml")).length;
  io.out(`converted ${args[0]} into ${args[1]}: ${nodes} nodes, ${tree.size - nodes} change records`);
  return 0;
}
