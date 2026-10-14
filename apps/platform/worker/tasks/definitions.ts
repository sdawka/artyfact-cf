/**
 * The task definitions create stores (`createRealizationPlan`) and the plan draft analyses: one copy, so a draft's
 * `analysis` is exactly the one create computes for its `request`.
 */
import type { SystemModel, TaskDefinition } from "@artyfact/model";
import type { SystemManifest } from "../../shared/api";
import type { CreateRealizationPlanRequest } from "../../shared/lifecycle";
import { taskFootprint } from "./footprint";

/** Links that make one task depend on another: it invokes, calls, reads or uses what the other writes. */
export const CONTRACT_RELS: ReadonlySet<string> = new Set(["invokes", "calls", "reads", "uses", "stepOperation"]);

/** The nodes and every node under them (write and read scope cover subtrees). */
export function expandNodes(model: SystemModel, nodes: string[]): string[] {
  return [...new Set([...nodes, ...Object.keys(model.index.byId).filter((id) => nodes.some((n) => model.index.path(id).includes(n)))])];
}

/**
 * Definitions for create's request tasks: write and read nodes expanded, footprints over each binding's tree, then
 * contract dependencies in the accepted ontology added as durable dependencies (never a runtime guess) and their
 * targets added to the reads, footprints retaken. Bindings must exist in `manifest`; create validates that first.
 */
export function taskDefinitions(
  model: SystemModel, manifest: SystemManifest, trees: Record<string, string[]>, tasks: CreateRealizationPlanRequest["tasks"],
): TaskDefinition[] {
  const defs: TaskDefinition[] = tasks.map((t) => {
    const repo = manifest.artifacts[t.artifactId]?.repo ?? "";
    const writeNodes = expandNodes(model, t.writeNodes), readNodes = expandNodes(model, t.readNodes);
    return { ...t, dependsOn: [...t.dependsOn], writeNodes, readNodes, footprint: taskFootprint(model, writeNodes, trees[t.artifactId] ?? [], t.artifactId, repo, readNodes) };
  });
  for (const t of defs) {
    const reads = t.writeNodes.flatMap((n) => (model.index.linksOut[n] ?? []).filter((l) => CONTRACT_RELS.has(l.rel)).map((l) => l.to));
    for (const other of defs) if (other.id !== t.id && other.writeNodes.some((n) => reads.includes(n)) && !t.dependsOn.includes(other.id)) t.dependsOn.push(other.id);
    t.readNodes = [...new Set([...t.readNodes, ...reads])];
    t.footprint = taskFootprint(model, t.writeNodes, trees[t.artifactId] ?? [], t.artifactId, t.footprint.repo, t.readNodes);
  }
  return defs;
}
