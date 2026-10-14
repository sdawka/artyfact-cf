import { describe, expect, it } from "vitest";
import { canMerge, canRemove, canSplit, draftErrors, mergeTasks, removeTask, renameTask, splitTask, type DraftTask } from "./draft";

const t = (id: string, o: Partial<DraftTask> = {}): DraftTask => ({ id, title: id.toUpperCase(), artifactId: "artifact.web", steps: [`do ${id}`], dependsOn: [], readNodes: [], writeNodes: [`n.${id}`], checks: [`C.${id}`], ...o });

describe("draft edits", () => {
  it("renames", () => expect(renameTask([t("a"), t("b")], "b", "Bee").map((x) => x.title)).toEqual(["A", "Bee"]));

  it("merges into the first, unites scope and repoints dependents", () => {
    const tasks = [t("a", { readNodes: ["n.b"] }), t("b"), t("c", { dependsOn: ["b"] })];
    const out = mergeTasks(tasks, ["a", "b"]);
    expect(out.map((x) => x.id)).toEqual(["a", "c"]);
    expect(out[0]).toMatchObject({ title: "A + B", steps: ["do a", "do b"], writeNodes: ["n.a", "n.b"], readNodes: [], checks: ["C.a", "C.b"] });
    expect(out[1]!.dependsOn).toEqual(["a"]);
  });

  it("refuses to merge fewer than two or across bindings", () => {
    expect(canMerge([t("a")], ["a"])).toBe("Select two or more tasks to merge.");
    expect(canMerge([t("a"), t("b", { artifactId: "artifact.api" })], ["a", "b"])).toBe("Only tasks on one binding merge; these are on artifact.web, artifact.api.");
  });

  it("splits write nodes into a new task that dependents also wait on", () => {
    const tasks = [t("a", { writeNodes: ["n.1", "n.2"] }), t("b", { dependsOn: ["a"] })];
    expect(canSplit(tasks[0]!, [])).toBe("Pick the write nodes that move to the new task.");
    expect(canSplit(tasks[0]!, ["n.1", "n.2"])).toBe("Leave at least one write node in this task.");
    const out = splitTask(tasks, "a", ["n.2"], "Second half");
    expect(out.map((x) => [x.id, x.title, x.writeNodes])).toEqual([["a", "A", ["n.1"]], ["a-2", "Second half", ["n.2"]], ["b", "B", ["n.b"]]]);
    expect(out[2]!.dependsOn).toEqual(["a", "a-2"]);
  });

  it("removes a task and the dependencies on it, keeping at least one", () => {
    expect(removeTask([t("a"), t("b", { dependsOn: ["a"] })], "a")).toEqual([t("b")]);
    expect(canRemove([t("a")])).toBe("A plan keeps at least one task.");
  });

  it("finds what create would refuse", () => {
    expect(draftErrors([t("a"), t("b")])).toEqual([]);
    expect(draftErrors([t("a", { dependsOn: ["b"] }), t("b", { dependsOn: ["a"] })])).toEqual(["The dependencies form a cycle."]);
    expect(draftErrors([t("a", { dependsOn: ["x"], writeNodes: [], title: "" })])).toEqual(["Task a needs a title.", "“a” writes no node.", "“” depends on an unknown task x."]);
  });
});
