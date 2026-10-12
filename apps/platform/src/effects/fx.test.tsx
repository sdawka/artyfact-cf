import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitFx, FX_EVENT, useEvaluationFx, useFxOnArrival, type FxDetail } from "./fx";

function capture() {
  const seen: FxDetail[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent<FxDetail>).detail);
  window.addEventListener(FX_EVENT, listener);
  return { seen, stop: () => window.removeEventListener(FX_EVENT, listener) };
}

afterEach(() => vi.restoreAllMocks());

describe("emitFx", () => {
  it("dispatches artyfact:fx at the viewport centre of the element", () => {
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left: 100, top: 40, width: 200, height: 60 } as DOMRect);
    const { seen, stop } = capture();
    emitFx({ kind: "promoted", strength: 1.6 }, el);
    emitFx({ kind: "commit" });
    stop();
    expect(seen).toEqual([{ kind: "promoted", strength: 1.6, x: 200, y: 70 }, { kind: "commit" }]);
  });
});

function Arrivals({ items }: { items?: string[] }) {
  useFxOnArrival(items, (i) => i, (fresh) => ({ kind: "commit", strength: fresh.length }));
  return null;
}

function Evals({ evals }: { evals?: { id: string; execution: string; verdict: string }[] }) {
  useEvaluationFx(evals);
  return null;
}

describe("arrival hooks", () => {
  it("seeds on the first list and emits once per batch of new keys", () => {
    const { seen, stop } = capture();
    const { rerender } = render(<Arrivals />);
    rerender(<Arrivals items={["a", "b"]} />);
    expect(seen).toEqual([]);
    rerender(<Arrivals items={["a", "b"]} />);
    rerender(<Arrivals items={["c", "a", "b", "d"]} />);
    stop();
    expect(seen).toEqual([{ kind: "commit", strength: 2 }]);
  });

  it("maps finished evaluations to fail or commit and ignores runs still in flight", () => {
    const { seen, stop } = capture();
    const { rerender } = render(<Evals evals={[]} />);
    rerender(<Evals evals={[{ id: "e1", execution: "running", verdict: "unknown" }]} />);
    rerender(<Evals evals={[{ id: "e1", execution: "completed", verdict: "pass" }]} />);
    rerender(<Evals evals={[{ id: "e1", execution: "completed", verdict: "pass" }, { id: "e2", execution: "completed", verdict: "fail" }]} />);
    stop();
    expect(seen.map((d) => d.kind)).toEqual(["commit", "fail"]);
  });
});
