import type { Proposal, ProposalProblem, ProposedOp } from "../../../../shared/api";
import { ApiRequestError, FixtureModeError, StaleBaseError } from "@/api/client";
import type { ChipTone } from "@/components/StatusChip/StatusChip";

/** What decided the proposal: `fake` when either side was fake, `off` when either side was off, else `real`. */
export function providerLabel(p: Proposal): "fake" | "off" | "real" {
  const { router, translator, fake } = p.provenance;
  if (fake || router.provider === "fake" || translator.provider === "fake") return "fake";
  if (router.provider === "off" || translator.provider === "off") return "off";
  return "real";
}

/** "82%"; the literal "unknown" when the step got no usable answer. */
export const confidenceText = (c: number) => (c > 0 && Number.isFinite(c) ? `${Math.round(c * 100)}%` : "unknown");

export const problemTone = (s: ProposalProblem["severity"]): ChipTone => (s === "error" ? "fail" : s === "missing" ? "attention" : "neutral");

/** `ids` plus every op that (transitively) depends on one of them: unchecking an op unchecks its dependents. */
export function withDependents(ops: readonly ProposedOp[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const op of ops) {
      if (out.has(op.id) || !op.dependsOn?.some((d) => out.has(d))) continue;
      out.add(op.id);
      grew = true;
    }
  }
  return out;
}

/** `ids` plus every op they (transitively) depend on: checking an op checks what it needs. */
export function withDependencies(ops: readonly ProposedOp[], ids: Iterable<string>): Set<string> {
  const byId = new Map(ops.map((o) => [o.id, o]));
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const d of byId.get(id)?.dependsOn ?? []) visit(d);
  };
  for (const id of ids) visit(id);
  return out;
}

/** A field value as text: strings verbatim, others as JSON; `undefined` is "none". */
export function valueText(v: unknown): string {
  if (v === undefined || v === "") return "none";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** The node's current value of `field` (`title` falls back to the model's `name`). */
export function currentField(item: unknown, field: string): unknown {
  const rec = (item ?? {}) as Record<string, unknown>;
  const fields = rec.fields && typeof rec.fields === "object" && !Array.isArray(rec.fields) ? (rec.fields as Record<string, unknown>) : {};
  return fields[field] ?? rec[field] ?? (field === "title" ? rec.name : undefined);
}

/** Error text for create / reply / accept. */
export function intentError(err: Error): string {
  if (err instanceof FixtureModeError) return err.message;
  if (err instanceof StaleBaseError) return "The Genome moved since this proposal was made (409 stale-base). Describe the change again.";
  if (err instanceof ApiRequestError) {
    if (err.status === 501) return "Intents not available yet: the platform answered 501 not-implemented.";
    if (err.status === 401) return "Describing a change needs the admin token (401). Set the admin token in the header and try again.";
    if (err.status === 403) return "The admin token was refused (403). Check it in the header and try again.";
    if (err.status === 422) return `The platform refused these changes (422): ${err.message}`;
  }
  return err.message;
}
