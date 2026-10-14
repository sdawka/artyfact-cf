import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Evolution } from "../../../shared/api";
import { renderApp } from "@/testing/render";
import { activeEvolutions } from "../work/groups";

vi.mock("@/model/useReviewCount", () => ({ useReviewCount: () => 2 }));

const evo = (id: string, state: string, kind = "genome-amendment") =>
  ({ id, title: id, state, kind, risk: "low", affectedNodes: [] }) as unknown as Evolution;

describe("activeEvolutions (design critique S17)", () => {
  it("leaves legacy and finished Evolutions out, by Work's classifier", () => {
    const all = [
      evo("e.legacy-proposed", "proposed", "implementation"),
      evo("e.legacy-evaluated", "evaluated", "implementation"),
      evo("e.proposed", "proposed"),
      evo("e.actionable", "actionable"),
      evo("e.promoted", "promoted"),
    ];
    // A legacy Evolution still in an active state stays in its state's group in Work, so it stays active here too.
    expect(activeEvolutions(all, new Map()).map((e) => e.id)).toEqual(["e.actionable", "e.legacy-evaluated", "e.proposed"]);
  });

  it("keeps a legacy Evolution that waits on someone, as Work does", () => {
    const all = [evo("e.legacy", "proposed", "implementation")];
    const signals = new Map([["e.legacy", { awaiting: 1, overlap: false, overlapWith: [], promotable: false }]]);
    expect(activeEvolutions(all, signals).map((e) => e.id)).toEqual(["e.legacy"]);
  });
});

describe("Overview Needs you (design critique P4)", () => {
  it("names the destination as a trailing word, as Home does, with no arrow glyph", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const row = within(needs).getByRole("link", { name: /decisions await your review/ });
    expect(row.textContent).toContain("Review ›");
    expect(needs.textContent).not.toMatch(/[→↓]/);
  });
});
