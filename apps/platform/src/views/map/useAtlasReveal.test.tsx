import { useState } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAtlasReveal } from "./useAtlasReveal";

const settings = vi.hoisted(() => ({ enabled: true, reduced: false }));
vi.mock("@/effects/effectsPreference", () => ({ useEffectsPreference: () => settings }));
vi.mock("@artyfact/effects", () => ({ useSystemReducedMotion: () => settings.reduced }));

function surface() {
  const element = document.createElement("div");
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
  element.animate = animate;
  return { element, animate, cancel };
}

describe("atlas reveals", () => {
  it("skips initial mount and unrelated renders; cancels interrupted scope changes and unmount", () => {
    settings.enabled = true; settings.reduced = false;
    const { element, animate, cancel } = surface();
    const { rerender, unmount } = renderHook(({ scope }) => useAtlasReveal(element, scope), { initialProps: { scope: "environment" } });
    expect(animate).not.toHaveBeenCalled();
    rerender({ scope: "system" });
    expect(animate).toHaveBeenCalledWith([{ opacity: 0.55 }, { opacity: 1 }], expect.objectContaining({ duration: 180 }));
    rerender({ scope: "system" });
    expect(animate).toHaveBeenCalledTimes(1);
    rerender({ scope: "child" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("waits for an opening overlay to attach and does not replay while it stays open", () => {
    settings.enabled = true; settings.reduced = false;
    const { element, animate } = surface();
    const { rerender } = renderHook(({ open, target }) => useAtlasReveal(target, open, 140), {
      initialProps: { open: false, target: null as HTMLElement | null },
    });
    rerender({ open: true, target: null });
    expect(animate).not.toHaveBeenCalled();
    rerender({ open: true, target: element });
    expect(animate).toHaveBeenCalledTimes(1);
    rerender({ open: true, target: element });
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("reveals a conditionally mounted overlay after its callback ref attaches", () => {
    settings.enabled = true; settings.reduced = false;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate;
    function Overlay({ open }: { open: boolean }) {
      const [element, setElement] = useState<HTMLElement | null>(null);
      useAtlasReveal(element, open, 140);
      return open ? <aside ref={setElement}>Selection</aside> : null;
    }
    try {
      const { rerender, unmount } = render(<Overlay open={false} />);
      expect(animate).not.toHaveBeenCalled();
      rerender(<Overlay open />);
      expect(animate).toHaveBeenCalledTimes(1);
      rerender(<Overlay open />);
      expect(animate).toHaveBeenCalledTimes(1);
      rerender(<Overlay open={false} />);
      expect(cancel).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      HTMLElement.prototype.animate = original;
    }
  });

  it.each(["reduced", "disabled"])("suppresses and cancels motion when %s", (mode) => {
    settings.enabled = true; settings.reduced = false;
    const { element, animate, cancel } = surface();
    const { rerender } = renderHook(({ scope }) => useAtlasReveal(element, scope), { initialProps: { scope: "environment" } });
    rerender({ scope: "system" });
    act(() => { if (mode === "reduced") settings.reduced = true; else settings.enabled = false; });
    rerender({ scope: "system" });
    expect(cancel).toHaveBeenCalledTimes(1);
    rerender({ scope: "child" });
    expect(animate).toHaveBeenCalledTimes(1);
    settings.enabled = true; settings.reduced = false;
    rerender({ scope: "child" });
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
