/**
 * `diff` engine, scope mode (C.system.promotion): changed paths ⊆ permitted globs, no protected glob touched, every
 * path mapped to a model node. Order: protected → fail; outside permitted → fail; unmapped → unknown; else pass.
 */
import picomatch from "picomatch";
import { errored, type Outcome } from "./provenance";

export interface ScopeInput {
  target: "app" | "genome";
  changedPaths: string[];
  changedNodes: string[];
  permitted: string[];
  protected: string[];
}

export const UNMAPPED = "unmapped:";
const GENOME_GLOB = "system/**";

const matcher = (globs: string[]) => (globs.length ? picomatch(globs, { dot: true }) : () => false);

export function diffScope(input: ScopeInput): Outcome {
  if (input.permitted.length === 0) return errored(new Error("no permitted globs in the Task Packet; scope cannot be checked"));
  if (input.changedPaths.length === 0) {
    return { execution: "completed", verdict: "unknown", observations: [{ changedPaths: 0 }], interpretation: "No changed paths vs base; nothing to judge.", limitations: [] };
  }
  const isPermitted = matcher(input.permitted);
  const isProtected = matcher(input.protected);
  const isGenome = picomatch(GENOME_GLOB, { dot: true });

  const protectedTouched = input.changedPaths.filter((p) => isProtected(p));
  const outsidePermitted = input.changedPaths.filter((p) => !isPermitted(p) && !protectedTouched.includes(p));
  // Genome candidates are judged by model-rules, not the source map: their paths are Genome files, not app code.
  const unmapped = input.target === "genome" ? [] : input.changedNodes.filter((n) => n.startsWith(UNMAPPED)).map((n) => n.slice(UNMAPPED.length));

  const observations: unknown[] = [];
  if (protectedTouched.length) observations.push({ protectedTouched });
  if (outsidePermitted.length) observations.push({ outsidePermitted });
  if (unmapped.length) observations.push({ unmapped });
  const limitations = input.target === "genome" ? ["Genome candidate: source-map coverage is not checked here; model-rules judges the Genome."] : [];

  if (protectedTouched.length || outsidePermitted.length) {
    const genomeTouched = input.target === "app" && protectedTouched.some((p) => isGenome(p));
    const interpretation = genomeTouched
      ? `Genome amendment required: an app realization changed ${protectedTouched.filter((p) => isGenome(p)).join(", ")}.`
      : [protectedTouched.length && `Protected paths changed: ${protectedTouched.join(", ")}.`, outsidePermitted.length && `Outside permitted paths: ${outsidePermitted.join(", ")}.`].filter(Boolean).join(" ");
    return { execution: "completed", verdict: "fail", observations, interpretation, limitations };
  }
  if (unmapped.length) {
    return { execution: "completed", verdict: "unknown", observations, interpretation: `Paths not mapped to any model node: ${unmapped.join(", ")}.`, limitations };
  }
  return { execution: "completed", verdict: "pass", observations: [{ changedPaths: input.changedPaths.length }], interpretation: "Every changed path is permitted and mapped.", limitations };
}
