import type { Finding } from "@artyfact/model";
import type { MeterSegment } from "@/components/Meter/Meter";
import type { UiVerdict } from "@/model/status";
import type { ReadinessReport } from "../../../shared/api";

export interface MeterModel {
  headline: string;
  segments: MeterSegment[];
}

const count = (xs: readonly Finding[], level: Finding["level"]) => xs.filter((f) => f.level === level).length;

/** Model readiness: findings by level. `incomplete`/`actionable` are read when the report carries them. */
export function readinessMeter(report: ReadinessReport): MeterModel {
  const findings = report.modelReadiness.findings;
  const errors = count(findings, "error");
  const extra = report as ReadinessReport & { incomplete?: boolean; actionable?: boolean };
  const actionable = extra.actionable ?? errors === 0;
  return {
    headline: extra.incomplete ? "unknown" : actionable ? "actionable" : "not actionable",
    segments: [
      { key: "error", label: "errors", count: errors, tone: "fail" },
      { key: "missing", label: "missing", count: count(findings, "missing"), tone: "warn" },
      { key: "warning", label: "warnings", count: count(findings, "warning"), tone: "subtle" },
    ],
  };
}

/** Implementation conformance over the given (scoped) verdicts; waived criteria are left out. */
export function conformanceMeter(verdicts: readonly UiVerdict[]): MeterModel {
  const counted = verdicts.filter((v) => v !== "waived");
  const n = (...vs: UiVerdict[]) => counted.filter((v) => vs.includes(v)).length;
  const pass = n("pass");
  const notRun = n("not-run");
  return {
    headline: counted.length === 0 ? "unknown" : notRun === counted.length ? "not run" : `${pass} of ${counted.length} pass`,
    segments: [
      { key: "pass", label: "pass", count: pass, tone: "pass" },
      { key: "fail", label: "fail", count: n("fail"), tone: "fail" },
      { key: "unknown", label: "unknown or stale", count: n("unknown", "stale"), tone: "subtle" },
      { key: "not-run", label: "not run", count: notRun, tone: "subtle", hatched: true },
    ],
  };
}

/** Outcome progress: Theory claims by status. Unknown until something is observed. */
export function outcomeMeter(claims: readonly { status: string; deferred: boolean }[]): MeterModel {
  const live = claims.filter((c) => !c.deferred);
  const n = (s: string) => live.filter((c) => c.status === s).length;
  const observed = live.length - n("unknown");
  return {
    headline: observed === 0 ? "unknown" : `${observed} of ${live.length} observed`,
    segments: [
      { key: "supported", label: "supported", count: n("supported"), tone: "pass" },
      { key: "challenged", label: "challenged", count: n("challenged"), tone: "fail" },
      { key: "inconclusive", label: "inconclusive", count: n("inconclusive"), tone: "subtle" },
      { key: "unknown", label: "unknown", count: n("unknown"), tone: "subtle" },
    ],
  };
}

const ACTIONS: [prefix: string, action: string][] = [
  ["node.provisional", "Review the provisional nodes in the Map and confirm or remove them."],
  ["coverage.hook", "Add a hook for the criterion."],
  ["coverage.requirement", "Add a requirement or criterion covering the subject."],
  ["hook.unbound", "Bind the hook to an implementation."],
  ["kit.unpinned", "Pin the kit under kits in the root node.yaml."],
  ["authz.", "Add or fix a policy that governs the subject."],
  ["topology.", "Change the model to satisfy the topology rule."],
  ["journey.", "Complete the journey so every step resolves."],
  ["theory.", "Complete the Theory claim."],
  ["evolution.", "Complete the Evolution."],
  ["template.", "Fix the template reference."],
  ["thing.", "Complete the Thing."],
  ["criterion.", "Fix the criterion's owner or subject."],
  ["ref.", "Fix the dangling reference."],
  ["tree.", "Fix the containment tree."],
  ["purpose.", "Fix the Purpose beneficiaries."],
  ["owner.", "Fix the owner reference."],
];

/** Next-action text for a rule family; falls back to pointing at the derivation. */
export function blockerAction(rule: string): string {
  return ACTIONS.find(([p]) => rule === p || (p.endsWith(".") && rule.startsWith(p)))?.[1] ?? "Show the derivation to see which facts produced this.";
}

/** Full shas shorten to 7 characters; names such as "canonical" and "head" stay. */
export const shortRev = (rev: string) => (/^[0-9a-f]{12,}$/.test(rev) ? rev.slice(0, 7) : rev);

/** "5 minutes ago"; "unknown" for invalid or epoch-zero timestamps (fixture data). */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= 0) return "unknown";
  const s = Math.round((t - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];
  const [unit, size] = units.find(([, sz]) => Math.abs(s) >= sz) ?? units[3]!;
  return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(Math.round(s / size), unit);
}

/**
 * The System's head commit from the same source as the TopBar's revision picker: the model's own `system.head` when it
 * has one, else the picker's head option ("head (sc-1)") resolved to the full System commit id it lists. Undefined only
 * when neither knows.
 */
export function headCommit(systemHead: string | null | undefined, revisions: readonly { id: string; kind: string; label: string }[] = []): string | undefined {
  if (systemHead) return systemHead;
  const short = /\(([^()]+)\)\s*$/.exec(revisions.find((r) => r.kind === "head")?.label ?? "")?.[1]?.trim();
  if (!short || short === "unknown") return undefined;
  return revisions.find((r) => r.kind === "commit" && (r.id === short || r.id.startsWith(`${short}-`)))?.id ?? short;
}
