import { useCallback, useEffect, useMemo, useReducer } from "react";

/**
 * One drafted path. `base` is the canonical text (null = the path is new); `content` is the draft (null = delete).
 * A draft whose content equals its base is not pending.
 */
export interface DraftFile {
  base: string | null;
  content: string | null;
}
export type Draft = Map<string, DraftFile>;

export type DraftAction =
  | { type: "set"; path: string; base: string | null; content: string }
  | { type: "delete"; path: string; base: string | null }
  | { type: "newFile"; path: string }
  | { type: "discard"; path: string }
  | { type: "clear" }
  | { type: "load"; draft: Draft };

export function draftReducer(state: Draft, action: DraftAction): Draft {
  const next = new Map(state);
  switch (action.type) {
    case "set": {
      const prev = state.get(action.path);
      const base = prev ? prev.base : action.base;
      // Typing a file back to its base text leaves nothing pending.
      if (action.content === base) next.delete(action.path);
      else next.set(action.path, { base, content: action.content });
      return next;
    }
    case "delete": {
      const prev = state.get(action.path);
      // Deleting a file that only exists in the draft just drops it.
      if (prev && prev.base === null) next.delete(action.path);
      else next.set(action.path, { base: prev ? prev.base : action.base, content: null });
      return next;
    }
    case "newFile":
      if (!state.has(action.path)) next.set(action.path, { base: null, content: "" });
      return next;
    case "discard":
      next.delete(action.path);
      return next;
    case "clear":
      return new Map();
    case "load":
      return action.draft;
  }
}

export type ChangeKind = "added" | "modified" | "deleted";

/** How a drafted path differs from its base, or null when it does not. */
export function changeKind(f: DraftFile | undefined): ChangeKind | null {
  if (!f || f.content === f.base) return null;
  if (f.base === null) return "added";
  if (f.content === null) return "deleted";
  return "modified";
}

/** The pending paths, sorted, with their kind. */
export function pendingChanges(draft: Draft): { path: string; kind: ChangeKind }[] {
  return [...draft.entries()]
    .flatMap(([path, f]) => {
      const kind = changeKind(f);
      return kind ? [{ path, kind }] : [];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The commit body's `changes`: every pending path, `content: null` for deletes. */
export function toRequestFiles(draft: Draft): { path: string; content: string | null }[] {
  return pendingChanges(draft).map(({ path }) => ({ path, content: draft.get(path)!.content }));
}

export const draftKey = (systemId: string, repo: string, rev: string) => `artyfact.draft.${systemId}.${repo}.${rev}`;

function load(key: string): Draft {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, DraftFile>;
    return new Map(Object.entries(obj).filter(([, f]) => f && typeof f === "object" && "base" in f && "content" in f));
  } catch {
    return new Map();
  }
}

function save(key: string, draft: Draft) {
  try {
    if (draft.size === 0) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(Object.fromEntries(draft)));
  } catch {
    // Storage full or blocked: the draft still lives in memory for this tab.
  }
}

/** The editor's draft for one `(system, repo, rev)`, persisted in `localStorage` so it survives reloads. */
export function useDraft(systemId: string, repo: string, rev: string) {
  const key = draftKey(systemId, repo, rev);
  const [state, dispatch] = useReducer(
    (s: { key: string; draft: Draft }, a: DraftAction | { type: "switch"; key: string }) =>
      a.type === "switch" ? { key: a.key, draft: load(a.key) } : { key: s.key, draft: draftReducer(s.draft, a) },
    key,
    (k) => ({ key: k, draft: load(k) }),
  );
  // A different System, repo or revision has its own draft.
  if (state.key !== key) dispatch({ type: "switch", key });
  const draft = state.key === key ? state.draft : load(key);

  useEffect(() => {
    save(state.key, state.draft);
  }, [state]);

  const pending = useMemo(() => pendingChanges(draft), [draft]);
  return {
    draft,
    pending,
    isDirty: useCallback((path: string) => changeKind(draft.get(path)) !== null, [draft]),
    set: useCallback((path: string, base: string | null, content: string) => dispatch({ type: "set", path, base, content }), []),
    remove: useCallback((path: string, base: string | null) => dispatch({ type: "delete", path, base }), []),
    newFile: useCallback((path: string) => dispatch({ type: "newFile", path }), []),
    discard: useCallback((path: string) => dispatch({ type: "discard", path }), []),
    clear: useCallback(() => dispatch({ type: "clear" }), []),
    toRequestFiles: useCallback(() => toRequestFiles(draft), [draft]),
  };
}

export type DraftApi = ReturnType<typeof useDraft>;
