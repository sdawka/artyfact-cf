import { diffLines } from "diff";

export type DiffOp = "add" | "del" | "ctx";

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** Line number on the old side (absent for additions). */
  oldNo?: number;
  /** Line number on the new side (absent for deletions). */
  newNo?: number;
}

/** A run of lines to show (`hunk`) or a run of unchanged lines folded behind a "… n unchanged" collapser (`gap`). */
export type DiffBlock = { kind: "hunk"; lines: DiffLine[] } | { kind: "gap"; lines: DiffLine[] };

export interface LineDiffResult {
  blocks: DiffBlock[];
  added: number;
  removed: number;
}

const splitLines = (value: string): string[] => {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** Every line of the two texts with its op and line numbers. A null side is an empty file (added / removed path). */
export function diffAllLines(from: string | null, to: string | null): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const part of diffLines(from ?? "", to ?? "")) {
    for (const text of splitLines(part.value)) {
      if (part.added) out.push({ op: "add", text, newNo: newNo++ });
      else if (part.removed) out.push({ op: "del", text, oldNo: oldNo++ });
      else out.push({ op: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}

/**
 * Hunks with `context` unchanged lines around each change; longer unchanged runs become `gap` blocks the view folds
 * behind a "… n unchanged" collapser. Identical texts are one gap.
 */
export function lineDiff(from: string | null, to: string | null, context = 3): LineDiffResult {
  const lines = diffAllLines(from, to);
  const blocks: DiffBlock[] = [];
  const push = (kind: DiffBlock["kind"], ls: DiffLine[]) => {
    if (!ls.length) return;
    const last = blocks.at(-1);
    if (last && last.kind === kind) last.lines.push(...ls);
    else blocks.push({ kind, lines: [...ls] });
  };
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.op !== "ctx") {
      push("hunk", [lines[i]!]);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.op === "ctx") j++;
    const run = lines.slice(i, j);
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === lines.length ? 0 : context;
    if (run.length > keepHead + keepTail) {
      push("hunk", run.slice(0, keepHead));
      push("gap", run.slice(keepHead, run.length - keepTail));
      push("hunk", run.slice(run.length - keepTail));
    } else {
      push("hunk", run);
    }
    i = j;
  }
  return {
    blocks,
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "del").length,
  };
}
