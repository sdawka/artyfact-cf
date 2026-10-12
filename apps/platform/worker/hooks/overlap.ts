/**
 * Overlap between this candidate and each other open candidate of the System (C.system.readiness).
 *
 * Per pair:
 * - `file`: same target repo and at least one path changed by both (CLI-written TASK_PACKET.md, AGENTS.md and
 *   .artyfact/** excluded: every candidate changes them).
 * - `soft-semantic`: no shared path, but shared model nodes or criteria both reach (`overlap()` from the model).
 * - `hard-semantic`: both are Genome candidates sharing nodes, and the composed Genome (base + A's files + B's
 *   files) has a hard violation that neither has alone, on a node either touches.
 *   A composed Genome that does not parse (duplicate id, ...) is itself hard-semantic (`genome.parse: ...`).
 * Pairs with any conflict also get the System One `interference` judgment when a provider is given.
 * Failures never vanish: an open candidate whose Genome does not load, or a composition check that throws for any
 * reason other than a parse error, yields a `soft-semantic` report (empty nodes when nothing else is known) with the
 * failure in the message and `error` set, so the overlap evaluation is `unknown`, never `pass`.
 */
import { diffModels, overlap, type SemanticDelta, type SystemModel } from "@artyfact/model";
import { interference, type SystemOne } from "@artyfact/semantic";
import type { CandidateRef, ConflictContext, ConflictReport, FileMap } from "./contract";
import picomatch from "picomatch";
import { PLATFORM_WRITTEN, UNMAPPED } from "./diff-scope";
import { ModelParseError } from "@artyfact/model";
import { genomeRoot, loadGenome, runRules, type GenomeDeps } from "./model-rules";
import { errorMessage } from "./provenance";

export interface OverlapDeps {
  s1?: SystemOne;
  genome?: GenomeDeps;
}

interface Footprint {
  c: CandidateRef;
  nodes: string[];
  delta: SemanticDelta;
  model?: SystemModel;
  note?: string;
}

const isPlatformWritten = picomatch(PLATFORM_WRITTEN, { dot: true });
const uniq = (xs: Iterable<string>) => [...new Set(xs)].sort();
const emptyDelta = (): SemanticDelta => ({ added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] });
const touched = (d: SemanticDelta) => uniq([...d.added, ...d.removed, ...d.changed.map((c) => c.id)]);

/** Model footprint of a candidate: from the Genome diff for Genome candidates, from source-map nodes otherwise. */
function footprint(c: CandidateRef, base: SystemModel, deps: OverlapDeps): Footprint {
  const mapped = c.changedNodes.filter((n) => !n.startsWith(UNMAPPED));
  const fromNodes = (note?: string): Footprint => ({
    c, nodes: uniq(mapped), delta: { ...emptyDelta(), changed: uniq(mapped).map((id) => ({ id, fields: [] })) }, ...(note && { note }),
  });
  if (c.target !== "genome") return fromNodes();
  if (!c.genomeFiles) return fromNodes(`genome files unavailable for ${c.id}`);
  try {
    const model = loadGenome(c.genomeFiles, c.commit, deps.genome);
    const delta = diffModels(base, model);
    const ids = touched(delta);
    // A criterion change also touches the node it judges.
    const subjects = ids.flatMap((id) => {
      const e = model.index.byId[id] ?? base.index.byId[id];
      return e?.type === "criterion" ? [(e.item as { subjectId: string }).subjectId] : [];
    });
    return { c, nodes: uniq([...ids, ...subjects, ...mapped]), delta, model };
  } catch (e) {
    return fromNodes(`model delta unavailable for ${c.id}: ${errorMessage(e)}`);
  }
}

const GENOME_PREFIX = "system/";
const stripPrefix = (p: string) => (p.startsWith(GENOME_PREFIX) ? p.slice(GENOME_PREFIX.length) : p);

/**
 * base + every file A changed (from A) + every file B changed (from B), all in Genome-relative key space
 * (`genomeRoot` for file maps, `system/` stripped from changedPaths). Paths changed by both are file conflicts and
 * never reach here.
 */
export function compose(baseFiles: FileMap, a: CandidateRef, b: CandidateRef): FileMap {
  const out: FileMap = Object.fromEntries(genomeRoot(baseFiles));
  for (const c of [a, b]) {
    const files = genomeRoot(c.genomeFiles ?? {});
    for (const p of c.changedPaths.map(stripPrefix)) {
      const v = files.get(p);
      if (v !== undefined) out[p] = v;
      else delete out[p];
    }
  }
  return out;
}

const errorKeys = (m: SystemModel, deps: OverlapDeps) =>
  new Set(runRules(m, deps.genome).findings.filter((f) => f.level === "error").map((f) => `${f.rule}\u0000${f.subject ?? ""}`));

type HardResult = { nodes: string[]; rules: string[] } | { error: string } | null;

async function hardSemantic(ctx: ConflictContext, a: Footprint, b: Footprint, deps: OverlapDeps): Promise<HardResult> {
  if (!a.model || !b.model) return null;
  let composed: SystemModel;
  try {
    composed = loadGenome(compose(ctx.genomeFiles, a.c, b.c), `${a.c.commit}+${b.c.commit}`, deps.genome);
  } catch (e) {
    // Each loads alone, together they do not: that is a hard conflict by definition.
    if (e instanceof ModelParseError) return { nodes: [], rules: [`genome.parse: ${e.message}`] };
    return { error: `composition check failed: ${errorMessage(e)}` };
  }
  try {
    const alone = new Set([...errorKeys(a.model, deps), ...errorKeys(b.model, deps)]);
    const footprintNodes = new Set([...a.nodes, ...b.nodes]);
    const introduced = runRules(composed, deps.genome).findings.filter(
      (f) => f.level === "error" && !alone.has(`${f.rule}\u0000${f.subject ?? ""}`),
    );
    // A finding counts when its subject, or any fact in its derivation, mentions a node either candidate touches.
    const hits = introduced.filter((f) => (f.subject && footprintNodes.has(f.subject)) || f.facts.some((t) => t.some((v) => typeof v === "string" && footprintNodes.has(v))));
    if (!hits.length) return null;
    const nodes = uniq(hits.flatMap((f) => [f.subject ?? "", ...f.facts.flatMap((t) => t.filter((v): v is string => typeof v === "string" && footprintNodes.has(v)))]).filter(Boolean));
    return { nodes, rules: uniq(hits.map((f) => `${f.rule} ${f.subject ?? ""}`.trim())) };
  } catch (e) {
    return { error: `composition check failed: ${errorMessage(e)}` };
  }
}

export async function computeConflicts(ctx: ConflictContext, base: SystemModel, deps: OverlapDeps = {}): Promise<ConflictReport[]> {
  const me = footprint(ctx.candidate, base, deps);
  const reports: ConflictReport[] = [];
  for (const other of ctx.openCandidates) {
    if (other.id === ctx.candidate.id) continue;
    const them = footprint(other, base, deps);
    const notes = [me.note, them.note].filter(Boolean) as string[];
    const paths = other.target === ctx.candidate.target
      ? uniq(ctx.candidate.changedPaths.filter((p) => !isPlatformWritten(p) && other.changedPaths.includes(p)))
      : [];
    const o = overlap(me.delta, them.delta, base);
    const nodes = uniq([...o.shared, ...me.nodes.filter((n) => them.nodes.includes(n))]);
    const candidates = [ctx.candidate.id, other.id];
    let report: ConflictReport | null = null;
    let error = notes.length > 0;

    if (paths.length) {
      report = { kind: "file", candidates, nodes, paths, subjects: uniq([...paths, ...nodes]), message: `Both candidates change ${paths.join(", ")}.` };
    } else if (nodes.length || o.viaCriteria.length) {
      const hard = nodes.length ? await hardSemantic(ctx, me, them, deps) : null;
      if (hard && "rules" in hard) {
        const hn = uniq([...nodes, ...hard.nodes]);
        report = { kind: "hard-semantic", candidates, nodes: hn, paths: [], subjects: uniq([...hn, ...o.viaCriteria]), message: `Composed, the candidates violate ${hard.rules.join("; ")}.` };
      } else {
        if (hard && "error" in hard) {
          notes.push(hard.error);
          error = true;
        }
        const what = [nodes.length && `nodes ${nodes.join(", ")}`, o.viaCriteria.length && `criteria ${o.viaCriteria.join(", ")}`].filter(Boolean).join(" and ");
        report = { kind: "soft-semantic", candidates, nodes, paths: [], subjects: uniq([...nodes, ...o.viaCriteria]), message: `Different files, but both touch ${what}.` };
      }
    } else if (notes.length) {
      // Nothing comparable, because a footprint could not be computed: surface it instead of reporting "no overlap".
      report = { kind: "soft-semantic", candidates, nodes: [], paths: [], subjects: [], message: "Overlap could not be determined." };
    }
    if (!report) continue;
    if (notes.length) report.message += ` (${notes.join("; ")})`;
    if (error) report.error = notes.join("; ");
    if (deps.s1) {
      report.semantic = await interference(
        deps.s1,
        { evolution: ctx.candidate.evolutionId, changedSubjects: me.nodes, summary: `${ctx.candidate.target} candidate ${ctx.candidate.id}` },
        { evolution: other.evolutionId, changedSubjects: them.nodes, summary: `${other.target} candidate ${other.id}` },
        o,
        { journeys: o.viaJourneys, criteria: o.viaCriteria },
      );
    }
    reports.push(report);
  }
  return reports;
}
