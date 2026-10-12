/**
 * System vitals: a pure mapping from model and runtime data to Orb and AmbientField parameters, so the signature
 * effects show the System's real state. Each output line says which data drives it. The three meters stay separate in
 * the UI; this is a mood, not a score, and it is never shown as a number.
 */
import { useMemo } from "react";
import type { Finding } from "@artyfact/model";
import { WHIMSY, type OrbPresetName } from "@artyfact/effects";
import { useEvolutions, useHistory, useReadiness } from "@/api/queries";
import type { UiVerdict } from "@/model/status";
import { useModel } from "@/model/useModel";

/** Overall health, in priority order: `failing` (a fail verdict), `blocked` (error/missing findings), `passing` (every counted criterion passes), else `pending`. */
export type SystemHealth = "failing" | "blocked" | "passing" | "pending";

export interface VitalsInput {
  /** Readiness findings (any level). `incomplete` means the rules engine could not finish. */
  readiness: { findings: readonly Pick<Finding, "level" | "subject">[]; incomplete?: boolean };
  /** Number of indexed model objects, to turn finding counts into a ratio. */
  entryCount: number;
  /** Scoped verdicts of the non-deferred Thing criteria (as the conformance meter counts them). */
  verdicts: readonly UiVerdict[];
  evolutions: readonly { id: string; state: string }[];
  realizations: readonly { evolution: string; status: string; updatedAt?: string; checkpoints?: readonly { at: string }[] }[];
  /** System commits, newest first. */
  commits: readonly { createdAt?: string }[];
  /** Evaluation finish times, any scope. */
  evaluationTimes: readonly string[];
  /** Epoch ms; injectable for tests. */
  now: number;
}

export interface SystemVitals {
  health: SystemHealth;
  /** Orb preset for the health (passing → verdant, failing or blocked → ember, else apricot). */
  preset: OrbPresetName;
  /** Orb params; spread onto `<Orb {...vitals.orb} />`. */
  orb: { preset: OrbPresetName; fill: number; crackle: number; strands: number; sparks: number; flares: number };
  /** AmbientField params; spread onto `<AmbientField {...vitals.ambient} />`. */
  ambient: { color: string; intensity: number };
  /** The intermediate measures, for tests and tooltips. */
  measures: { readiness: number; troubled: number; active: number; recent: number; blockers: number };
}

const ACTIVE_EVOLUTION = new Set(["actionable", "realizing", "evaluated"]);
const ACTIVE_REALIZATION = new Set(["claimed", "working", "submitted", "evaluating", "evaluated", "selected", "awaiting-admin"]);
/** Activity half-life for sparks and ambient intensity: an event 6 h old counts half. */
const HALF_LIFE_MS = 6 * 3600_000;
const COLOR: Record<OrbPresetName, string> = { apricot: WHIMSY.apricot, verdant: WHIMSY.success, ember: WHIMSY.error, tide: WHIMSY.info, dusk: WHIMSY.dusk };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Sum of exp-decayed weights of timestamps; unparseable or epoch-zero times (fixtures) count as nothing. */
function recency(times: Iterable<string | undefined>, now: number): number {
  let sum = 0;
  for (const t of times) {
    const ms = t ? Date.parse(t) : Number.NaN;
    if (!Number.isFinite(ms) || ms <= 0 || ms > now + 60_000) continue;
    sum += Math.pow(0.5, (now - ms) / HALF_LIFE_MS);
  }
  return sum;
}

export function systemVitals(input: VitalsInput): SystemVitals {
  const { findings } = input.readiness;
  const blocking = findings.filter((f) => f.level === "error" || f.level === "missing");
  const warnings = findings.filter((f) => f.level === "warning");
  const subjects = (fs: typeof findings) => new Set(fs.map((f, i) => f.subject ?? `#${i}`)).size;
  // Readiness ratio: share of model objects without findings; blocking subjects count fully, warning subjects a quarter. Unknown (incomplete) reads as 0.5.
  const readiness = input.readiness.incomplete
    ? 0.5
    : clamp01(1 - (subjects(blocking) + 0.25 * subjects(warnings)) / Math.max(1, input.entryCount));

  const counted = input.verdicts.filter((v) => v !== "waived");
  const n = (...vs: UiVerdict[]) => counted.filter((v) => vs.includes(v)).length;
  // Troubled share: fail and stale verdicts over counted criteria.
  const troubled = counted.length ? n("fail", "stale") / counted.length : 0;

  const health: SystemHealth =
    n("fail") > 0 ? "failing" : blocking.length > 0 ? "blocked" : counted.length > 0 && n("pass") === counted.length ? "passing" : "pending";
  const preset: OrbPresetName = health === "passing" ? "verdant" : health === "pending" ? "apricot" : "ember";

  const live = input.realizations.filter((r) => ACTIVE_REALIZATION.has(r.status));
  const covered = new Set(live.map((r) => r.evolution));
  // Active work: live realizations plus active Evolutions nobody is realizing yet.
  const active = live.length + input.evolutions.filter((e) => ACTIVE_EVOLUTION.has(e.state) && !covered.has(e.id)).length;

  // Recent activity: commits, realization checkpoints and finished evaluations, decayed by age.
  const recent = recency(
    [
      ...input.commits.map((c) => c.createdAt),
      ...input.realizations.flatMap((r) => (r.checkpoints ?? []).map((c) => c.at)),
      ...input.evaluationTimes,
    ],
    input.now,
  );
  // Overall activity 0..1: active work saturates at 4, recent events at 6.
  const activity = clamp01(0.5 * Math.min(1, active / 4) + 0.5 * Math.min(1, recent / 6));

  return {
    health,
    preset,
    orb: {
      preset,
      // fill ← readiness ratio, kept in 0.2..0.9 where the haze pool reads well.
      fill: round(0.2 + 0.7 * readiness),
      // crackle ← fail + stale share: a calm rim at 0.25, fully agitated at 1.
      crackle: round(0.25 + 0.75 * troubled),
      // strands ← active realizations/Evolutions, one strand each, 1..8.
      strands: Math.min(8, Math.max(1, active)),
      // sparks ← recent commits, checkpoints and evaluations: 0.15 idle, +0.12 per fresh event, max 1.
      sparks: round(Math.min(1, 0.15 + 0.12 * recent)),
      // flares ← open blockers (error/missing findings): 0.25 with none, +0.15 each, max 1.
      flares: round(Math.min(1, 0.25 + 0.15 * blocking.length)),
    },
    ambient: {
      // ambient colour ← the preset's palette colour.
      color: COLOR[preset],
      // ambient intensity ← overall activity, 0.25 quiet to 0.6 busy (kept dim behind text).
      intensity: round(0.25 + 0.35 * activity),
    },
    measures: { readiness: round(readiness), troubled: round(troubled), active, recent: round(recent), blockers: blocking.length },
  };
}

/** {@link systemVitals} for the current System and revision. Needs the `ModelProvider` route context. */
export function useSystemVitals(now?: number): SystemVitals {
  const m = useModel();
  const { data: readinessData } = useReadiness();
  const { data: board } = useEvolutions();
  const { data: commits } = useHistory();
  // A malformed or partial response (old API, test stubs) falls back to the bundled report rather than crashing the Shell.
  const report = readinessData?.modelReadiness?.findings ? readinessData : m.bundle.readiness;
  return useMemo(() => {
    const criteria = (m.index.model.criteria ?? []).filter((c) => c.ownerKind === "thing" && !c.deferred);
    const live = board?.evolutions ?? [];
    return systemVitals({
      readiness: { findings: report.modelReadiness.findings, incomplete: (report as { incomplete?: boolean }).incomplete },
      entryCount: m.index.entries.length,
      verdicts: criteria.map((c) => m.verdictOf(c.id)),
      evolutions: live.length ? live : (m.index.model.evolutions ?? []),
      realizations: board?.realizations ?? [],
      commits: commits ?? [],
      evaluationTimes: m.evaluations.flatMap((e) => (e.finishedAt ? [e.finishedAt] : [])),
      now: now ?? Date.now(),
    });
  }, [m, report, board, commits, now]);
}
