import { describe, expect, it } from "vitest";
import type { LinkRef, SystemModel } from "@artyfact/model";
import type { Task, TaskFootprint } from "../../shared/api";
import { derivedDependencies, literalPrefix, PlanError, syntheticDelta, taskConflicts, waves } from "../../worker/tasks/independence";

/** Just the index maps `overlap()` and `derivedDependencies` read. */
function model(i: { links?: [string, string, string][]; criteria?: Record<string, string[]>; journeys?: Record<string, string[]> } = {}): SystemModel {
  const linksOut: Record<string, LinkRef[]> = {};
  for (const [from, rel, to] of i.links ?? []) (linksOut[from] ??= []).push({ from, rel, to, certainty: "declared" });
  return { index: { linksOut, criteriaBySubject: i.criteria ?? {}, journeysByNode: i.journeys ?? {} } } as unknown as SystemModel;
}

const fp = (paths: string[] = [], globs: string[] = [], unmatched: string[] = []): TaskFootprint =>
  ({ globs: [...new Set([...globs, ...unmatched])], paths, unmatched, entryFiles: [] });

function task(id: string, nodes: string[], footprint: TaskFootprint = fp(), dependsOn: string[] = []): Task {
  return {
    id, evolutionId: "evolution.1", title: id, intent: id, thing: "thing.webapp", nodes, footprint,
    acceptanceCriteria: [], dependsOn, status: "planned", origin: "fallback",
  };
}

describe("syntheticDelta", () => {
  it("marks every node changed, deduplicated and sorted", () => {
    expect(syntheticDelta(["b", "a", "b"])).toEqual({ added: [], removed: [], changed: [{ id: "a", fields: [] }, { id: "b", fields: [] }], affectedCriteria: [], affectedJourneys: [] });
  });
});

describe("taskConflicts", () => {
  const m = model({ criteria: { "screen.a": ["C.a"] }, journeys: { "screen.a": ["J.1"], "screen.b": ["J.1"] } });

  it("reports declared over file over soft-semantic, one per pair", () => {
    const shared = fp(["src/x.ts"]);
    const a = task("task.a", ["screen.a"], shared);
    const b = task("task.b", ["screen.a"], shared, ["task.a"]);
    const c = task("task.c", ["screen.a"], shared);
    const d = task("task.d", ["screen.a"], fp(["src/d.ts"]));
    const out = taskConflicts([d, c, b, a], m);
    const kind = (x: string, y: string) => out.find((k) => k.tasks[0] === x && k.tasks[1] === y)?.kind;
    expect(out).toHaveLength(6);
    expect(kind("task.a", "task.b")).toBe("declared");
    expect(kind("task.a", "task.c")).toBe("file");
    expect(kind("task.a", "task.d")).toBe("soft-semantic");
    expect(out.find((k) => k.kind === "file")!.subjects).toEqual(["src/x.ts"]);
  });

  it("ignores platform-written paths", () => {
    const a = task("task.a", ["n.a"], fp(["AGENTS.md", ".artyfact/x.json"]));
    const b = task("task.b", ["n.b"], fp(["AGENTS.md", ".artyfact/x.json"]));
    expect(taskConflicts([a, b], model())).toEqual([]);
  });

  it("reports may-create for unmatched globs with nested literal prefixes", () => {
    const a = task("task.a", ["n.a"], fp([], [], ["src/ui/people/**"]));
    const b = task("task.b", ["n.b"], fp([], ["src/ui/**"]));
    const c = task("task.c", ["n.c"], fp([], [], ["src/worker/**"]));
    const out = taskConflicts([a, b, c], model());
    expect(out.map((k) => [k.kind, ...k.tasks])).toEqual([["file", "task.a", "task.b"]]);
    expect(out[0].subjects).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(out[0].message).toContain("may create");
  });

  it("does not compare two matched globs by prefix (paths decide)", () => {
    const a = task("task.a", ["n.a"], fp(["src/ui/a.ts"], ["src/ui/**"]));
    const b = task("task.b", ["n.b"], fp(["src/ui/people/b.ts"], ["src/ui/people/**"]));
    expect(taskConflicts([a, b], model())).toEqual([]);
  });

  it("does not report a pair that shares only a journey", () => {
    const a = task("task.a", ["screen.a"], fp(["src/a.ts"]));
    const b = task("task.b", ["screen.b"], fp(["src/b.ts"]));
    expect(taskConflicts([a, b], m)).toEqual([]);
  });

  it("literal prefixes", () => {
    expect(literalPrefix("src/ui/people/**")).toBe("src/ui/people/");
    expect(literalPrefix("src/foo*.ts")).toBe("src/");
    expect(literalPrefix("**")).toBe("");
    expect(literalPrefix("playwright.config.ts")).toBe("playwright.config.ts");
  });
});

describe("derivedDependencies", () => {
  it("follows invokes|calls|reads|uses|stepOperation links between tasks' nodes", () => {
    const m = model({
      links: [
        ["screen.a", "invokes", "operation.b"],
        ["operation.b", "reads", "entity.c"],
        ["screen.a", "contains", "entity.c"],
        ["screen.a", "invokes", "screen.a2"],
      ],
    });
    const tasks = [task("task.c", ["entity.c"]), task("task.a", ["screen.a", "screen.a2"]), task("task.b", ["operation.b"])];
    expect(derivedDependencies(tasks, m)).toEqual({ "task.a": ["task.b"], "task.b": ["task.c"], "task.c": [] });
  });
});

describe("waves", () => {
  it("puts a chain in three waves", () => {
    const ts = [task("task.a", ["a"]), task("task.b", ["b"], fp(), ["task.a"]), task("task.c", ["c"], fp(), ["task.b"])];
    expect(waves(ts, taskConflicts(ts, model()))).toEqual([["task.a"], ["task.b"], ["task.c"]]);
  });

  it("splits file conflicts, never soft-semantic ones", () => {
    const m = model();
    const ts = [
      task("task.a", ["n.shared"], fp(["src/x.ts"])),
      task("task.b", ["n.b"], fp(["src/x.ts"])),
      task("task.c", ["n.shared"], fp(["src/c.ts"])),
    ];
    const conflicts = taskConflicts(ts, m);
    expect(conflicts.map((c) => c.kind).sort()).toEqual(["file", "soft-semantic"]);
    expect(waves(ts, conflicts)).toEqual([["task.a", "task.c"], ["task.b"]]);
  });

  it("throws plan-cycle on a dependency cycle", () => {
    const ts = [task("task.a", ["a"], fp(), ["task.b"]), task("task.b", ["b"], fp(), ["task.a"]), task("task.c", ["c"])];
    let err: unknown;
    try {
      waves(ts, []);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PlanError);
    expect((err as PlanError).code).toBe("plan-cycle");
    expect((err as PlanError).ids).toEqual(["task.a", "task.b"]);
  });

  it("is deterministic under shuffled input", () => {
    const ts = [
      task("task.a", ["a"], fp(["src/x.ts"])),
      task("task.b", ["b"], fp(["src/x.ts"])),
      task("task.c", ["c"], fp(["src/y.ts"]), ["task.a"]),
      task("task.d", ["d"], fp(["src/y.ts"])),
      task("task.e", ["e"], fp(["src/z.ts"]), ["task.d"]),
    ];
    const m = model();
    const expected = waves(ts, taskConflicts(ts, m));
    const expectedConflicts = taskConflicts(ts, m);
    for (const order of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 4, 0, 3, 2]]) {
      const shuffled = order.map((i) => ts[i]);
      expect(taskConflicts(shuffled, m)).toEqual(expectedConflicts);
      expect(waves(shuffled, taskConflicts(shuffled, m))).toEqual(expected);
    }
    expect(expected).toEqual([["task.a", "task.d"], ["task.b", "task.c", "task.e"]]);
  });
});
