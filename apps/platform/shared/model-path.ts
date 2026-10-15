/**
 * The pinned model's place in an app-repo tree (docs/design/task-fork-model.md). A Task fork, and so every app head a
 * promotion lands, carries the pinned Genome under `system/`; file views group those paths apart from the app's code.
 */
import type { ChangedFiles } from "./api";

export const MODEL_PREFIX = "system";
export const isModelPath = (p: string): boolean => p === MODEL_PREFIX || p.startsWith(`${MODEL_PREFIX}/`);

/** An app repo's changed files split into its code and the pinned model copy under `system/`. */
export function splitPinnedModel(files: ChangedFiles): { code: ChangedFiles; pinned: ChangedFiles } {
  const part = (keep: (p: string) => boolean): ChangedFiles => ({ added: files.added.filter(keep), modified: files.modified.filter(keep), removed: files.removed.filter(keep) });
  return { code: part((p) => !isModelPath(p)), pinned: part(isModelPath) };
}

export const changedCount = (f: ChangedFiles | null | undefined): number => (f ? f.added.length + f.modified.length + f.removed.length : 0);
