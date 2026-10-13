import type { SystemSummary } from "../../../shared/api";
import { buildTone, type ChipTone } from "@/components/StatusChip/StatusChip";

/** A SystemSummary from any server version: every iteration-2 field is optional and may be missing. */
export type CardSummary = SystemSummary;

export type CardTone = "attention" | "evolving" | "unbuilt" | "quiet";

export interface DeployLine {
  status: string;
  glyph?: string;
  label: string;
  tone: ChipTone;
  title?: string;
  /** The latest build, folded into the deploy line. */
  build?: { status: string; label: string; tone: ChipTone; title: string };
}

export interface CardView {
  /** One sentence: attention > evolving > not built > quiet. */
  headline: string;
  tone: CardTone;
  deploy: DeployLine;
  /** The System's head Review, present only when something awaits. */
  reviewHref?: string;
}

const base = (systemId: string) => `/s/${encodeURIComponent(systemId)}/r/head`;

function awaiting(s: CardSummary): number | undefined {
  return (s.signifiers ?? []).includes("awaiting-admin") ? (s.realizationCounts?.awaitingAdmin ?? 0) : undefined;
}

function deployLine(s: CardSummary): DeployLine {
  let line: DeployLine;
  switch (s.deployState) {
    case "live":
      line = { status: "deployed", glyph: "●", label: "deployed", tone: "neutral" };
      break;
    case "behind":
      line = { status: "behind", glyph: "●", label: "deployed, behind", tone: "attention", title: "Production runs an older app commit than the System head." };
      break;
    case "failed":
      line = { status: "deploy-failed", glyph: "×", label: "deploy failed", tone: "fail" };
      break;
    case "pending":
      line = { status: "deploy-pending", label: "deploying", tone: "neutral" };
      break;
    default:
      line = { status: "not-deployed", label: "not deployed, unknown", tone: "neutral" };
  }
  const b = s.latestBuild;
  if (b) {
    const tone = buildTone(b.status);
    line.build = { status: b.status, label: `build ${b.status}`, tone, title: `Latest build ${b.id} of ${b.commit.slice(0, 7)}` };
  }
  return line;
}

/** What a Home card says, from the server's `signifiers[]` plus counts. Success tone only for a passed build. */
export function cardSummary(s: CardSummary): CardView {
  const sig = new Set(s.signifiers ?? []);
  const deploy = deployLine(s);
  const n = awaiting(s);
  if (n !== undefined)
    return {
      headline: n === 0 ? "awaiting your review" : `${n} ${n === 1 ? "awaits" : "await"} your review`,
      tone: "attention",
      deploy,
      reviewHref: `${base(s.systemId)}/review`,
    };
  if (sig.has("evolving")) {
    const e = s.realizationCounts?.evolving;
    return { headline: e ? `${e} ${e === 1 ? "realization" : "realizations"} evolving` : "evolving", tone: "evolving", deploy };
  }
  if (sig.has("not-fully-built")) return { headline: "not built", tone: "unbuilt", deploy };
  return { headline: "quiet", tone: "quiet", deploy };
}

const RANK: Record<CardTone, number> = { attention: 0, evolving: 1, unbuilt: 2, quiet: 2 };

/** Attention first, then evolving, then the most recently updated. Returns a new array. */
export function sortByAttention(systems: readonly CardSummary[]): CardSummary[] {
  const time = (s: CardSummary) => Date.parse(s.updatedAt) || 0;
  return [...systems].sort((a, b) => RANK[cardSummary(a).tone] - RANK[cardSummary(b).tone] || time(b) - time(a));
}

export interface LedgerRow {
  key: string;
  systemId: string;
  title: string;
  text: string;
  href: string;
  tone: "attention" | "fail";
}

/** One row per pending decision across Systems, in the order given: candidates to review, then deploy trouble. */
export function needsYou(systems: readonly CardSummary[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const s of systems) {
    const title = s.title || s.systemId;
    const n = awaiting(s);
    if (n !== undefined)
      rows.push({
        key: `${s.systemId}:review`, systemId: s.systemId, title, tone: "attention", href: `${base(s.systemId)}/review`,
        text: n === 0 ? "candidates await review" : `${n} ${n === 1 ? "candidate awaits" : "candidates await"} review`,
      });
    if (s.deployState === "behind")
      rows.push({ key: `${s.systemId}:behind`, systemId: s.systemId, title, tone: "attention", href: `${base(s.systemId)}/phenome`, text: "deployed, behind" });
    if (s.deployState === "failed")
      rows.push({ key: `${s.systemId}:failed`, systemId: s.systemId, title, tone: "fail", href: `${base(s.systemId)}/phenome`, text: "deploy failed" });
  }
  return rows;
}
