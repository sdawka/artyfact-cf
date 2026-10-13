import type { Signifier, SystemSummary } from "../../../shared/api";
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
  /** One sentence: awaiting review > import pending > tasks await an agent > plan ready > wave running > evolving > not built > quiet. */
  headline: string;
  tone: CardTone;
  /** The card's border state: `tone`, except that deploy trouble on an otherwise quiet System reads as attention. */
  state: CardTone;
  deploy: DeployLine;
  /** The System's head Review, present only when something awaits. */
  reviewHref?: string;
  /** The System's Work view, present when a plan or its tasks need a person. */
  workHref?: string;
}

const base = (systemId: string) => `/s/${encodeURIComponent(systemId)}/r/head`;

function awaiting(s: CardSummary): number | undefined {
  return (s.signifiers ?? []).includes("awaiting-admin") ? (s.realizationCounts?.awaitingAdmin ?? 0) : undefined;
}

const sig = (s: CardSummary, k: Signifier) => (s.signifiers ?? []).includes(k);
const importPending = (s: CardSummary) => sig(s, "import-pending") || s.importReview?.status === "pending";
/** Tasks claimed and waiting on an agent; undefined when the summary does not say so. */
const awaitingAgent = (s: CardSummary) => (sig(s, "task-awaiting-agent") ? (s.taskCounts?.awaitingAgent ?? 0) : undefined);
const planReady = (s: CardSummary) => (sig(s, "plan-ready") ? (s.taskCounts?.planReady ?? 0) : undefined);

const tasksText = (n: number) => (n === 0 ? "tasks await an agent" : `${n} ${n === 1 ? "task awaits" : "tasks await"} an agent`);
const planText = (n: number) => (n > 1 ? `${n} plans are ready` : "a plan is ready");

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
  const view = headlineOf(s);
  const trouble = s.deployState === "behind" || s.deployState === "failed";
  return { ...view, state: view.tone === "quiet" && trouble ? "attention" : view.tone };
}

function headlineOf(s: CardSummary): Omit<CardView, "state"> {
  const deploy = deployLine(s);
  const n = awaiting(s);
  const work = `${base(s.systemId)}/work`;
  if (n !== undefined)
    return {
      headline: n === 0 ? "awaiting your review" : `${n} ${n === 1 ? "awaits" : "await"} your review`,
      tone: "attention",
      deploy,
      reviewHref: `${base(s.systemId)}/review`,
    };
  if (importPending(s)) return { headline: "import awaits review", tone: "attention", deploy, reviewHref: `${base(s.systemId)}/review` };
  const a = awaitingAgent(s);
  if (a !== undefined) return { headline: tasksText(a), tone: "attention", deploy, workHref: work };
  const p = planReady(s);
  if (p !== undefined) return { headline: planText(p), tone: "attention", deploy, workHref: work };
  if (sig(s, "wave-running")) return { headline: "wave running", tone: "evolving", deploy, workHref: work };
  if (sig(s, "evolving")) {
    const e = s.realizationCounts?.evolving;
    return { headline: e ? `${e} ${e === 1 ? "realization" : "realizations"} evolving` : "evolving", tone: "evolving", deploy };
  }
  if (sig(s, "not-fully-built")) return { headline: "not built", tone: "unbuilt", deploy };
  return { headline: "quiet", tone: "quiet", deploy };
}

const RANK: Record<CardTone, number> = { attention: 0, evolving: 1, unbuilt: 2, quiet: 2 };

/** Attention first, then evolving, then the most recently updated. Returns a new array. */
export function sortByAttention(systems: readonly CardSummary[]): CardSummary[] {
  const keyed = systems.map((s) => ({ s, rank: RANK[cardSummary(s).state], time: Date.parse(s.updatedAt) || 0 }));
  return keyed.sort((a, b) => a.rank - b.rank || b.time - a.time).map((k) => k.s);
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
    if (importPending(s))
      rows.push({ key: `${s.systemId}:import`, systemId: s.systemId, title, tone: "attention", href: `${base(s.systemId)}/review`, text: "import awaits review" });
    const a = awaitingAgent(s);
    if (a !== undefined)
      rows.push({ key: `${s.systemId}:agent`, systemId: s.systemId, title, tone: "attention", href: `${base(s.systemId)}/work`, text: tasksText(a) });
    const p = planReady(s);
    if (p !== undefined)
      rows.push({ key: `${s.systemId}:plan`, systemId: s.systemId, title, tone: "attention", href: `${base(s.systemId)}/work`, text: planText(p) });
    if (s.deployState === "behind")
      rows.push({ key: `${s.systemId}:behind`, systemId: s.systemId, title, tone: "attention", href: `${base(s.systemId)}/phenome`, text: "deployed, behind" });
    if (s.deployState === "failed")
      rows.push({ key: `${s.systemId}:failed`, systemId: s.systemId, title, tone: "fail", href: `${base(s.systemId)}/phenome`, text: "deploy failed" });
  }
  return rows;
}
