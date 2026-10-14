import type { RealizationPlan, Task, TaskAttempt } from "../../../../shared/lifecycle";

/** A three-task plan: t1 and t2 in wave 1 (disjoint source), t3 in wave 2 depending on both. */
export const NOW = Date.parse("2026-10-13T12:00:00Z");
const footprint = (globs: string[], paths: string[], known = true) => ({ repo: "web", artifactId: "artifact.web", globs, paths, unmatched: [], known });

export function task(id: string, o: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, artifactId: "artifact.web", steps: [`Do ${id}`], dependsOn: [], readNodes: [], writeNodes: [`component.${id}`], checks: [],
    footprint: footprint([`src/${id}/**`], [`src/${id}/index.ts`]),
    planId: "plan.one", status: "pending", base: { repo: "web", commit: "c".repeat(40) } as Task["base"], forkRepo: `web--${id}`, attempts: [], selectedCandidate: null,
    ...o,
  };
}

export function attempt(o: Partial<TaskAttempt> = {}): TaskAttempt {
  return { id: "att.1", taskId: "t1", generation: 1, realizationId: "r.1", status: "working", agentLabel: "claude", leaseExpiresAt: new Date(NOW + 600_000).toISOString(), createdAt: "", ...o };
}

export function makePlan(o: Partial<RealizationPlan> = {}): RealizationPlan {
  return {
    id: "plan.one", systemId: "system.peopling", title: "Implement birthdays", genome: { repo: "genome", commit: "a".repeat(40) }, baseHead: "sc-1",
    baseManifest: {} as RealizationPlan["baseManifest"], ontologyDigest: "d", status: "planned",
    tasks: [task("t1", { writeNodes: ["component.t1", "component.extra", "screen.a", "screen.b", "screen.c"] }), task("t2"), task("t3", { dependsOn: ["t1", "t2"] })],
    analysis: {
      waves: [["t1", "t2"], ["t3"]],
      conflicts: [
        { tasks: ["t1", "t3"], kind: "dependency", subjects: [], message: "t1 and t3: dependency interference" },
        { tasks: ["t2", "t3"], kind: "source", subjects: ["src/shared.ts"], message: "t2 and t3: source interference" },
      ],
    },
    integration: [], createdAt: "", updatedAt: "u1",
    ...o,
  };
}
