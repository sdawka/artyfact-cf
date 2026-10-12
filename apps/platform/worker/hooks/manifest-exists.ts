/** `manifest` engine (C.webapp.exists): required files present and non-empty in the candidate tree. */
import type { TreeEntry } from "./contract";
import { errored, type Outcome } from "./provenance";

const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/^\.?\//, "");

export function manifestExists(tree: TreeEntry[], inputs: Record<string, string>): Outcome {
  const required = (inputs.requiredFiles ?? "").split(",").map(norm).filter(Boolean);
  if (required.length === 0) return errored(new Error("hook.inputs.requiredFiles is empty; nothing to check"));
  const sizes = new Map(tree.map((e) => [norm(e.path), e.size] as const));
  const missing = required.filter((p) => !sizes.has(p));
  const empty = required.filter((p) => sizes.has(p) && !((sizes.get(p) ?? 0) > 0));
  const ok = missing.length === 0 && empty.length === 0;
  return {
    execution: "completed",
    verdict: ok ? "pass" : "fail",
    observations: [{ missing, empty, required: required.length }],
    interpretation: ok ? `All ${required.length} required files are present and non-empty.` : `Missing: ${missing.join(", ") || "none"}; empty: ${empty.join(", ") || "none"}.`,
    limitations: ["Checks presence and size only, not content."],
  };
}
