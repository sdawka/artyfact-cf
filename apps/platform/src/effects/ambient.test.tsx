import { WHIMSY } from "@artyfact/effects";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyRollup } from "@/model/status";
import { renderApp } from "@/testing/render";
import { nodeStatus } from "@/views/map/MapView";
import { FX_EVENT, parseAmbientFx } from "./ambientEvents";
import { EFFECTS_KEY } from "./effectsPreference";

const BASE = "/s/system.peopling/r/head";
const fx = (detail: unknown) => act(() => void window.dispatchEvent(new CustomEvent(FX_EVENT, { detail })));
const ambient = () => document.querySelector<HTMLElement>("[data-shell-ambient]")!;

afterEach(() => window.localStorage.clear());

/** The bar shows Effects and Retry API inline from 1280px; jsdom starts at 1024. */
const wide = () => {
  const original = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  return () => void Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
};

let restoreWidth = () => {};
beforeEach(() => { restoreWidth = wide(); });
afterEach(() => restoreWidth());

describe("parseAmbientFx", () => {
  it("accepts the five kinds, keeps finite coordinates and clamps strength", () => {
    expect(parseAmbientFx({ kind: "promoted", x: 10, y: 20, strength: 9 })).toEqual({ kind: "promoted", x: 10, y: 20, strength: 2 });
    expect(parseAmbientFx({ kind: "select", x: Number.NaN })).toEqual({ kind: "select" });
    for (const bad of [null, "fail", {}, { kind: "explode" }, { kind: 3 }]) expect(parseAmbientFx(bad)).toBeNull();
  });
});

describe("nodeStatus", () => {
  it("glows fail for any fail and pass only when every counted criterion passes", () => {
    expect(nodeStatus({ ...emptyRollup(), pass: 3, fail: 1 })).toBe("fail");
    expect(nodeStatus({ ...emptyRollup(), pass: 3, waived: 1 })).toBe("pass");
    expect(nodeStatus({ ...emptyRollup(), pass: 3, notRun: 1 })).toBeUndefined();
    expect(nodeStatus(emptyRollup())).toBeUndefined();
  });
});

describe("Shell ambient field", () => {
  it("mounts one fixed field coloured by System health", async () => {
    renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    expect(document.querySelectorAll("[data-shell-ambient] [data-effect=ambient]")).toHaveLength(1);
    expect(ambient().dataset.health).toMatch(/^(failing|blocked|passing|pending)$/);
    expect(ambient().querySelector<HTMLElement>("[data-effect]")!.style.position).toBe("fixed");
  });

  // Waits out the real 1.8 s accent hold; give a loaded machine room.
  it("tints by event kind, ignores malformed events, and eases back", { timeout: 15_000 }, async () => {
    renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    fx({ kind: "nope" });
    expect(ambient().dataset.accent).toBeUndefined();
    fx({ kind: "select", x: 10, y: 10 });
    expect(ambient().dataset.accent).toBeUndefined();
    fx({ kind: "promoted" });
    expect(ambient().dataset.accent).toBe(WHIMSY.success);
    fx({ kind: "fail", x: 5, y: 5, strength: 1 });
    expect(ambient().dataset.accent).toBe(WHIMSY.error);
    await waitFor(() => expect(ambient().dataset.accent).toBeUndefined(), { timeout: 4_000 });
  });
});

describe("Effects switch", () => {
  it("defaults on, toggles from the TopBar, persists, and is offered in the palette", async () => {
    const first = renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    const button = screen.getByRole("button", { name: /Effects/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(EFFECTS_KEY)).toBe("off");
    expect(document.querySelector("[data-effects]")!.getAttribute("data-effects")).toBe("off");
    first.unmount();

    renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    expect(screen.getByRole("button", { name: /Effects/ }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => void fireEvent.keyDown(window, { key: "k", metaKey: true }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "effects" } });
    const item = await within(dialog).findByRole("option", { name: /Effects: turn on/ });
    await act(async () => void fireEvent.click(item));
    await waitFor(() => expect(screen.getByRole("button", { name: /Effects/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(window.localStorage.getItem(EFFECTS_KEY)).toBe("on");
  });

  it("survives storage that throws", async () => {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const get = proto.getItem;
    const set = proto.setItem;
    proto.getItem = () => { throw new Error("blocked"); };
    proto.setItem = () => { throw new Error("blocked"); };
    try {
      renderApp(`${BASE}/overview`);
      await screen.findByRole("heading", { level: 1, name: "Peopling" });
      const button = screen.getByRole("button", { name: /Effects/ });
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("false");
    } finally {
      proto.getItem = get;
      proto.setItem = set;
    }
  });
});
