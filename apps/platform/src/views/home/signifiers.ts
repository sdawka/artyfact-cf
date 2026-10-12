import type { SystemSummary } from "../../../shared/api";
import { buildTone, type ChipTone } from "@/components/StatusChip/StatusChip";

/** A SystemSummary from any server version: every iteration-2 field is optional and may be missing. */
export type CardSummary = SystemSummary;

export interface CardChip {
  key: string;
  status: string;
  label: string;
  tone: ChipTone;
  glyph?: string;
  title?: string;
}

export interface CardSignals {
  /** `attention` (someone must act) wins over `evolving`, which wins over `unbuilt`. */
  state: "attention" | "evolving" | "unbuilt" | undefined;
  chips: CardChip[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a Home card shows, from the server's `signifiers[]` plus counts. Never uses the success tone
 * except for a latest build that `passed`.
 */
export function cardSignals(s: CardSummary): CardSignals {
  const sig = new Set(s.signifiers ?? []);
  const counts = s.realizationCounts;
  const chips: CardChip[] = [];

  if (sig.has("evolving")) {
    const n = counts?.evolving;
    chips.push({ key: "evolving", status: "evolving", glyph: "↗", tone: "attention", label: n ? plural(n, "realization evolving", "realizations evolving") : "evolving" });
  }
  if (sig.has("pending-realization")) {
    const n = counts?.pending ?? 0;
    chips.push({ key: "pending", status: "pending-realization", tone: "neutral", label: n ? plural(n, "pending realization", "pending realizations") : "pending realizations" });
  }
  if (sig.has("awaiting-admin")) {
    const n = counts?.awaitingAdmin ?? 0;
    chips.push({ key: "awaiting", status: "awaiting-admin", tone: "attention", label: n ? `${n} awaiting review` : "awaiting review" });
  }
  if (sig.has("not-fully-built")) {
    chips.push({ key: "unbuilt", status: "not-fully-built", tone: "neutral", label: "not built", title: "Readiness has errors or missing items, or no app commit has been built." });
  }

  switch (s.deployState) {
    case "live":
      chips.push({ key: "deploy", status: "deployed", glyph: "●", tone: "neutral", label: "deployed" });
      break;
    case "behind":
      chips.push({ key: "deploy", status: "behind", glyph: "●", tone: "attention", label: "deployed, behind", title: "Production runs an older app commit than the System head." });
      break;
    case "failed":
      chips.push({ key: "deploy", status: "deploy-failed", glyph: "×", tone: "fail", label: "deploy failed" });
      break;
    case "pending":
      chips.push({ key: "deploy", status: "deploy-pending", tone: "neutral", label: "deploying" });
      break;
    default:
      chips.push({ key: "deploy", status: "not-deployed", tone: "neutral", label: "not deployed, unknown" });
  }

  if (s.latestBuild) {
    const b = s.latestBuild;
    chips.push({ key: "build", status: b.status, tone: buildTone(b.status), label: `build ${b.status}`, title: `Latest build ${b.id} of ${b.commit.slice(0, 7)}` });
  }
  if (sig.has("observed")) chips.push({ key: "observed", status: "observed", glyph: "◍", tone: "neutral", label: "observed" });

  const state = sig.has("awaiting-admin") ? "attention" : sig.has("evolving") ? "evolving" : sig.has("not-fully-built") ? "unbuilt" : undefined;
  return { state, chips };
}
