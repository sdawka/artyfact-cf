/**
 * `diff` engine, scope mode (C.system.promotion): changed paths ⊆ permitted globs, no protected glob touched, every
 * path mapped to a model node. Order: protected → fail; outside permitted → fail; unmapped → unknown; else pass.
 * Files the CLI writes at the clone root (TASK_PACKET.md, AGENTS.md, .artyfact/**) are always permitted and mapped;
 * they are reported as `platformWritten` so the UI can grey them out.
 */
import picomatch from "picomatch";
import { errored, type Outcome } from "./provenance";

export interface ScopeInput {
  target: "app" | "genome";
  changedPaths: string[];
  changedNodes: string[];
  /** Source-map result per path. Required for a pass: without it, every non-platform path is unattributed. */
  pathNodes?: Record<string, string[]>;
  permitted: string[];
  protected: string[];
}

export const UNMAPPED = "unmapped:";
const GENOME_GLOB = "system/**";
/** Written by `artyfact start` at the clone root; never a scope violation. */
export const PLATFORM_WRITTEN = ["TASK_PACKET.md", "AGENTS.md", ".artyfact/**"];
const isPlatformWritten = picomatch(PLATFORM_WRITTEN, { dot: true });

const matcher = (globs: string[]) => (globs.length ? picomatch(globs, { dot: true }) : () => false);

/**
 * Changed (non-platform) paths with no model node, per `pathNodes` (no entry, an empty list or only `unmapped:`
 * markers). Without `pathNodes` no path can be attributed, so every changed non-platform path counts as unmapped:
 * scope never passes on `changedNodes` alone.
 */
function unmappedPaths(paths: string[], input: ScopeInput): string[] {
  if (!input.pathNodes) return paths;
  return paths.filter((p) => !(input.pathNodes![p] ?? []).some((n) => !n.startsWith(UNMAPPED)));
}

export function diffScope(input: ScopeInput): Outcome {
  if (input.permitted.length === 0) return errored(new Error("no permitted globs in the Task Packet; scope cannot be checked"));
  const platformWritten = input.changedPaths.filter((p) => isPlatformWritten(p));
  const written = platformWritten.length ? [{ platformWritten }] : [];
  const changedPaths = input.changedPaths.filter((p) => !isPlatformWritten(p));
  if (changedPaths.length === 0) {
    return { execution: "completed", verdict: "unknown", observations: [{ changedPaths: 0 }, ...written], interpretation: "No changed paths vs base besides platform-written files; nothing to judge.", limitations: [] };
  }
  const isPermitted = matcher(input.permitted);
  const isProtected = matcher(input.protected);
  const isGenome = picomatch(GENOME_GLOB, { dot: true });

  const protectedTouched = changedPaths.filter((p) => isProtected(p));
  const outsidePermitted = changedPaths.filter((p) => !isPermitted(p) && !protectedTouched.includes(p));
  // Genome candidates are judged by model-rules, not the source map: their paths are Genome files, not app code.
  const unmapped = input.target === "genome" ? [] : unmappedPaths(changedPaths, input);

  const observations: unknown[] = [...written];
  if (protectedTouched.length) observations.push({ protectedTouched });
  if (outsidePermitted.length) observations.push({ outsidePermitted });
  if (unmapped.length) observations.push({ unmapped });
  const limitations = input.target === "genome"
    ? ["Genome candidate: source-map coverage is not checked here; model-rules judges the Genome."]
    : input.pathNodes ? [] : ["pathNodes not supplied: changed paths cannot be attributed to model nodes."];

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
  return { execution: "completed", verdict: "pass", observations: [{ changedPaths: changedPaths.length }, ...written], interpretation: "Every changed path is permitted and mapped.", limitations };
}
