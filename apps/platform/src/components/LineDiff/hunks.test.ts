import { describe, expect, it } from "vitest";
import { lineDiff } from "./hunks";

const lines = (n: number, prefix = "l") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join("\n") + "\n";

describe("lineDiff", () => {
  it("numbers additions, deletions and context on both sides", () => {
    const d = lineDiff("a\nb\nc\n", "a\nB\nc\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]!.lines).toEqual([
      { op: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { op: "del", text: "b", oldNo: 2 },
      { op: "add", text: "B", newNo: 2 },
      { op: "ctx", text: "c", oldNo: 3, newNo: 3 },
    ]);
  });

  it("keeps 3 lines of context and folds the rest into gaps", () => {
    const before = lines(20);
    const after = before.replace("l10\n", "ten\n");
    const d = lineDiff(before, after);
    expect(d.blocks.map((b) => [b.kind, b.lines.length])).toEqual([["gap", 6], ["hunk", 8], ["gap", 7]]);
    const hunk = d.blocks[1]!.lines;
    expect(hunk[0]!.text).toBe("l7");
    expect(hunk.at(-1)!.text).toBe("l13");
  });

  it("splits two distant changes into two hunks with a gap between", () => {
    const before = lines(30);
    const after = before.replace("l2\n", "two\n").replace("l28\n", "x\n");
    const kinds = lineDiff(before, after).blocks.map((b) => b.kind);
    expect(kinds).toEqual(["hunk", "gap", "hunk"]);
  });

  it("does not fold a short unchanged run between changes", () => {
    const d = lineDiff("a\nb\nc\nd\ne\n", "A\nb\nc\nd\nE\n");
    expect(d.blocks.map((b) => b.kind)).toEqual(["hunk"]);
  });

  it("treats a null side as an empty file", () => {
    expect(lineDiff(null, "x\ny\n")).toMatchObject({ added: 2, removed: 0 });
    expect(lineDiff("x\n", null)).toMatchObject({ added: 0, removed: 1 });
    expect(lineDiff(null, "x\n").blocks[0]!.lines[0]).toEqual({ op: "add", text: "x", newNo: 1 });
  });

  it("folds identical texts into one gap", () => {
    expect(lineDiff(lines(5), lines(5)).blocks.map((b) => b.kind)).toEqual(["gap"]);
  });
});
