import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { useModelBundle } from "@/api/queries";
import { buildIndex } from "@/model/index";
import { ModelProvider } from "@/model/useModel";
import { renderApp } from "@/testing/render";
import type { Evolution } from "../../shared/api";
import { activeEvolutions } from "@/views/work/groups";
import type { EvolutionSignal } from "@/views/work/useEvolutionSignals";
import { systemVitals, useSystemVitals, type VitalsInput } from "./vitals";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

/** Vitals input from the peopling fixture with nothing run yet (the fixture has no evaluations or history). */
function fixtureInput(): VitalsInput {
  const bundle = fixtureBundle();
  const index = buildIndex(bundle);
  const criteria = (bundle.model.criteria ?? []).filter((c) => c.ownerKind === "thing" && !c.deferred);
  return {
    readiness: { findings: bundle.readiness.modelReadiness.findings },
    entryCount: index.entries.length,
    verdicts: criteria.map(() => "not-run" as const),
    evolutions: (bundle.model.evolutions ?? []) as Evolution[],
    signals: new Map(),
    realizations: [],
    commits: [],
    evaluationTimes: [],
    now: NOW,
  };
}

describe("systemVitals (peopling fixture)", () => {
  it("reads as pending apricot: warnings only, nothing run, one actionable Evolution", () => {
    const input = fixtureInput();
    const v = systemVitals(input);
    expect(v.health).toBe("pending");
    expect(v.preset).toBe("apricot");
    expect(v.surface.preset).toBe("apricot");
    // 15 warnings and no blockers: mostly ready, so fill sits high but below full.
    expect(v.measures.blockers).toBe(0);
    expect(v.measures.readiness).toBeGreaterThan(0.8);
    expect(v.measures.readiness).toBeLessThan(1);
    expect(v.surface.level).toBeCloseTo(0.2 + 0.7 * v.measures.readiness, 2);
    expect(v.surface.agitation).toBe(0.25);
    expect(v.surface.alerts).toBe(0.25);
    // Active as Work groups them: the actionable Evolution and the proposed Genome amendments, not legacy history.
    const active = activeEvolutions(input.evolutions, input.signals).length;
    expect(active).toBe(3);
    expect(v.measures.active).toBe(active);
    expect(v.surface.channels).toBe(active);
    // Fixture timestamps are absent, so no recent activity.
    expect(v.surface.activity).toBe(0.15);
    expect(v.ambient).toEqual({ color: "oklch(0.79 0.125 60)", intensity: round(0.25 + 0.35 * 0.5 * (3 / 4)) });
  });

  it("turns verdant when every counted criterion passes", () => {
    const input = fixtureInput();
    const v = systemVitals({ ...input, verdicts: [...input.verdicts.map(() => "pass" as const), "waived" as const] });
    expect(v.health).toBe("passing");
    expect(v.surface.preset).toBe("verdant");
    expect(v.ambient.color).toBe("oklch(0.723 0.081 166.2)");
  });

  it("turns ember on failures and crackles with the fail + stale share", () => {
    const input = fixtureInput();
    const verdicts = input.verdicts.map((_, i) => (i < 5 ? "fail" : i < 10 ? "stale" : "pass") as "fail" | "stale" | "pass");
    const v = systemVitals({ ...input, verdicts });
    expect(v.health).toBe("failing");
    expect(v.preset).toBe("ember");
    expect(v.measures.troubled).toBeCloseTo(10 / verdicts.length, 3);
    expect(v.surface.agitation).toBeCloseTo(0.25 + 0.75 * (10 / verdicts.length), 3);
  });

  it("turns ember on blockers, flares per blocker and lowers fill", () => {
    const input = fixtureInput();
    const blockers = ["a", "b", "c"].map((subject) => ({ level: "error" as const, rule: "x.blocked", subject }));
    const v = systemVitals({ ...input, readiness: { findings: [...input.readiness.findings, ...blockers] } });
    expect(v.health).toBe("blocked");
    expect(v.preset).toBe("ember");
    expect(v.surface.alerts).toBeCloseTo(0.7, 3);
    expect(v.surface.level).toBeLessThan(systemVitals(input).surface.level);
  });

  it("reads incomplete readiness as half full", () => {
    const v = systemVitals({ ...fixtureInput(), readiness: { findings: [], incomplete: true } });
    expect(v.surface.level).toBeCloseTo(0.55, 3);
  });

  it("counts active Evolutions as Work groups them, one strand each, capped at 8", () => {
    const evo = (id: string, state: string, kind = "genome-amendment") =>
      ({ id, title: id, state, kind, risk: "low", affectedNodes: [] }) as unknown as Evolution;
    const evolutions = [
      evo("e.actionable", "actionable"),
      evo("e.proposed", "proposed"),
      evo("e.promoted", "promoted"),
      // Legacy history: not active unless it is realizing or waits on someone.
      evo("e.legacy", "proposed", "implementation"),
      evo("e.legacy-waiting", "proposed", "implementation"),
    ];
    const signals = new Map([["e.legacy-waiting", { awaiting: 1, overlap: false, overlapWith: [], promotable: false } as EvolutionSignal]]);
    const v = systemVitals({ ...fixtureInput(), evolutions, signals });
    expect(v.measures.active).toBe(3);
    expect(v.measures.active).toBe(activeEvolutions(evolutions, signals).length);
    expect(v.surface.channels).toBe(3);
    const many = Array.from({ length: 12 }, (_, i) => evo(`e.${i}`, "realizing"));
    expect(systemVitals({ ...fixtureInput(), evolutions: many }).surface.channels).toBe(8);
  });

  it("sparks and brightens with recent commits, checkpoints and evaluations", () => {
    const input = fixtureInput();
    const busy = systemVitals({
      ...input,
      commits: [{ createdAt: hoursAgo(0) }, { createdAt: hoursAgo(6) }, { createdAt: "1970-01-01T00:00:00.000Z" }],
      realizations: [{ checkpoints: [{ at: hoursAgo(0) }] }],
      evaluationTimes: [hoursAgo(0), hoursAgo(48)],
    });
    // 1 + 0.5 + 1 + 1 + 0.0039 recent; the epoch-zero commit is ignored.
    expect(busy.measures.recent).toBeCloseTo(3.504, 2);
    expect(busy.surface.activity).toBeCloseTo(0.15 + 0.12 * 3.504, 2);
    expect(busy.ambient.intensity).toBeGreaterThan(systemVitals(input).ambient.intensity);
    expect(busy.ambient.intensity).toBeLessThanOrEqual(0.6);
  });
});

const round = (v: number) => Math.round(v * 1000) / 1000;

function Probe() {
  const v = useSystemVitals(NOW);
  return <output aria-label="vitals">{JSON.stringify(v.surface)}</output>;
}
function Harness() {
  const { data } = useModelBundle();
  if (!data) return null;
  return (
    <ModelProvider bundle={data}>
      <Probe />
    </ModelProvider>
  );
}

describe("useSystemVitals", () => {
  it("maps the loaded fixture System through useModel()", async () => {
    renderApp("/s/system.peopling/r/head/x", [{ path: "/s/:systemId/r/:rev/x", element: <Harness /> }]);
    const out = await screen.findByLabelText("vitals");
    expect(JSON.parse(out.textContent!)).toEqual(systemVitals(fixtureInput()).surface);
  });
});
