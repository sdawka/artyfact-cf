// Test helpers: reads a v2 Genome tree from disk into an engine Graph and composes the meta@1 templates it pins.
import { composeTemplates, parseTree, readTree, type Graph, type NodeFile, type Template } from "@artyfact/ontology";
import { readDir } from "@artyfact/ontology/artyfact/node";
import { loadMetaTemplate, metaTemplates } from "../src/index";

export const GENERIC_THINGS = [
  "template.thing.cloudflare-worker-service@1",
  "template.thing.ts-library@1",
  "template.thing.cli@1",
  "template.thing.static-site@1",
];
export const SYSTEM = "template.system.dev-platform.cloudflare@1";

/** One evaluable template from the System template and the Thing templates (`composeTemplates`); it keeps the System's ref. */
export const compose = (refs: string[]): Template =>
  composeTemplates({ template: loadMetaTemplate(refs[0]!) }, refs.slice(1).map((r) => ({ template: loadMetaTemplate(r) })));

/** Reads a Genome tree (`node.yaml` per directory) into a Graph through the codec, and the parsed node files by id. */
export function readGenome(dir: string): { graph: Graph; nodes: Map<string, NodeFile> } {
  const files = readDir(dir);
  return { graph: readTree(files, metaTemplates), nodes: new Map([...parseTree(files).nodes.values()].map((n) => [n.id, n.file])) };
}
