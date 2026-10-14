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

/** The targets of contract links out of (expanded) write nodes: what a task with those writes depends on. */
export function contractReads(model: SystemModel, writeNodes: string[]): string[] {
  return writeNodes.flatMap((n) => (model.index.linksOut[n] ?? []).filter((l) => CONTRACT_RELS.has(l.rel)).map((l) => l.to));
}

/** Derived dependencies by index: task j depends on every other task k whose (expanded) writes j's contract reads name. */
export function contractDependencies(model: SystemModel, writes: string[][]): number[][] {
  return writes.map((w, j) => {
    const reads = contractReads(model, w);
    return writes.flatMap((other, k) => (k !== j && other.some((n) => reads.includes(n)) ? [k] : []));
  });
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
  const derived = contractDependencies(model, defs.map((t) => t.writeNodes));
  defs.forEach((t, j) => {
    for (const k of derived[j]) if (!t.dependsOn.includes(defs[k].id)) t.dependsOn.push(defs[k].id);
    t.readNodes = [...new Set([...t.readNodes, ...contractReads(model, t.writeNodes)])];
    t.footprint = taskFootprint(model, t.writeNodes, trees[t.artifactId] ?? [], t.artifactId, t.footprint.repo, t.readNodes);
  });
  return defs;
}
