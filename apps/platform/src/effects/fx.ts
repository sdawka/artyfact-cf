/**
 * Event moments: views announce a promotion, a submission, a commit or a failing evaluation as an `artyfact:fx` window
 * event, and the signature effects (the Overview orb, the Shell's ambient field) react. Fire-and-forget: nothing
 * depends on a listener, and the hooks here never touch business logic.
 */
import { useEffect, useRef } from "react";
import { FX_EVENT, parseAmbientFx, type AmbientFxDetail, type AmbientFxKind } from "./ambientEvents";

export { FX_EVENT };
/** The `artyfact:fx` detail; one type shared with the Shell's ambient field (`ambientEvents.ts`). */
export type FxKind = AmbientFxKind;
export type FxDetail = AmbientFxDetail;

/** Dispatch `artyfact:fx`. With `el`, `x`/`y` default to the viewport centre of its box. */
export function emitFx(detail: FxDetail, el?: Element | null) {
  if (typeof window === "undefined") return;
  let d = detail;
  if (el && d.x === undefined && d.y === undefined) {
    const r = el.getBoundingClientRect();
    if (r.width || r.height) d = { ...d, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  window.dispatchEvent(new CustomEvent<FxDetail>(FX_EVENT, { detail: d }));
}

/** Calls `onFx` for every well-formed `artyfact:fx` event while mounted. */
export function useFx(onFx: (d: FxDetail) => void) {
  const cb = useRef(onFx);
  cb.current = onFx;
  useEffect(() => {
    const listener = (e: Event) => {
      const d = parseAmbientFx((e as CustomEvent).detail);
      if (d) cb.current(d);
    };
    window.addEventListener(FX_EVENT, listener);
    return () => window.removeEventListener(FX_EVENT, listener);
  }, []);
}

/**
 * Emits once per batch of items whose key was not seen before. The first defined list only seeds what is known, so
 * opening a view never fires. `toDetail` gets the fresh items and returns the event, or null for none.
 */
export function useFxOnArrival<T>(items: readonly T[] | undefined, key: (item: T) => string, toDetail: (fresh: T[]) => FxDetail | null) {
  const seen = useRef<Set<string> | null>(null);
  const fns = useRef({ key, toDetail });
  fns.current = { key, toDetail };
  useEffect(() => {
    if (!items) return;
    const { key: k, toDetail: to } = fns.current;
    if (!seen.current) {
      seen.current = new Set(items.map(k));
      return;
    }
    const known = seen.current;
    const fresh = items.filter((i) => !known.has(k(i)));
    if (!fresh.length) return;
    for (const i of fresh) known.add(k(i));
    const detail = to(fresh);
    if (detail) emitFx(detail);
  }, [items]);
}

interface EvaluationLike { id: string; execution: string; verdict: string; finishedAt?: string }

/** `fail` when a fresh, finished evaluation failed or errored; `commit` when fresh results all came back clean. */
export function useEvaluationFx(evaluations: readonly EvaluationLike[] | undefined) {
  useFxOnArrival(
    evaluations,
    (e) => `${e.id}|${e.execution}|${e.verdict}`,
    (fresh) => {
      const done = fresh.filter((e) => e.execution === "completed" || e.execution === "error");
      if (!done.length) return null;
      const bad = done.some((e) => e.verdict === "fail" || e.execution === "error");
      return bad ? { kind: "fail" } : { kind: "commit", strength: 0.8 };
    },
  );
}
