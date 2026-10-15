import { StatusText } from "@/components/StatusText/StatusText";
import type { TheoryClaim } from "@/model/types";

const STATUS = {
  unknown: { glyph: "○", tone: "neutral" },
  inconclusive: { glyph: "◐", tone: "neutral" },
  supported: { glyph: "●", tone: "neutral" },
  challenged: { glyph: "✕", tone: "fail" },
} as const;

/** Claim status as glyph + word. Never green: a supported hypothesis is still a hypothesis. */
export function ClaimStatus({ status }: { status: TheoryClaim["status"] }) {
  const s = STATUS[status];
  return <StatusText status={status} tone={s.tone} glyph={s.glyph} />;
}
