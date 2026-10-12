/**
 * Overlap between this candidate and each other open candidate of the System (C.system.readiness).
 *
 * Per pair:
 * - `file`: same target repo and at least one path changed by both.
 * - `soft-semantic`: no shared path, but shared model nodes or criteria both reach (`overlap()` from the model).
 * - `hard-semantic`: both are Genome candidates sharing nodes, and the composed Genome (base + A's files + B's
 *   files) has a hard violation that neither has alone, on a node either touches.
 * Pairs with any conflict also get the System One `interference` judgment when a provider is given.
 * Failures to load a candidate's Genome or compose are written into the report message, never dropped.
 */
import { diffModels, overlap, type SemanticDelta, type SystemModel } from "@artyfact/model";
import { interference, type SystemOne } from "@artyfact/semantic";
import type { CandidateRef, ConflictContext, ConflictReport, FileMap } from "./contract";
import { UNMAPPED } from "./diff-scope";
import { loadGenome, runRules, type GenomeDeps } from "./model-rules";
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

const uniq = (xs: Iterable<string>) => [...new Set(xs)].sort();
const emptyDelta = (): SemanticDelta => ({ added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] });
const touched = (d: SemanticDelta) => uniq([...d.added, ...d.removed, ...d.changed.map((c) => c.id)]);

/** Model footprint of a candidate: from the Genome diff for Genome candidates, from source-map nodes otherwise. */
function footprint(c: CandidateRef, base: SystemModel, deps: OverlapDeps): Footprint {
  const mapped = c.changedNodes.filter((n) => !n.startsWith(UNMAPPED));
  const fromNodes = (note?: string): Footprint => ({
    c, nodes: uniq(mapped), delta: { ...emptyDelta(), changed: uniq(mapped).map((id) => ({ id, fields: [] })) }, ...(note && { note }),
  });
  if (c.target !== "genome" || !c.genomeFiles) return fromNodes();
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

/** base + every file A changed (from A) + every file B changed (from B). Paths changed by both must be identical. */
function compose(baseFiles: FileMap, a: CandidateRef, b: CandidateRef): FileMap {
  const out: FileMap = { ...baseFiles };
  for (const c of [a, b]) {
    const files = c.genomeFiles ?? {};
    for (const p of c.changedPaths) {
      if (p in files) out[p] = files[p];
      else delete out[p];
    }
  }
  return out;
}

const errorKeys = (m: SystemModel, deps: OverlapDeps) =>
  new Set(runRules(m, deps.genome).findings.filter((f) => f.level === "error").map((f) => `${f.rule}\u0000${f.subject ?? ""}`));

async function hardSemantic(ctx: ConflictContext, a: Footprint, b: Footprint, deps: OverlapDeps): Promise<{ nodes: string[]; rules: string[] } | { note: string } | null> {
  if (!a.model || !b.model) return null;
  try {
    const composed = loadGenome(compose(ctx.genomeFiles, a.c, b.c), `${a.c.commit}+${b.c.commit}`, deps.genome);
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
    return { note: `composition check failed: ${errorMessage(e)}` };
  }
}

export async function computeConflicts(ctx: ConflictContext, base: SystemModel, deps: OverlapDeps = {}): Promise<ConflictReport[]> {
  const me = footprint(ctx.candidate, base, deps);
  const reports: ConflictReport[] = [];
  for (const other of ctx.openCandidates) {
    if (other.id === ctx.candidate.id) continue;
    const them = footprint(other, base, deps);
    const notes = [me.note, them.note].filter(Boolean) as string[];
    const paths = other.target === ctx.candidate.target ? uniq(ctx.candidate.changedPaths.filter((p) => other.changedPaths.includes(p))) : [];
    const o = overlap(me.delta, them.delta, base);
    const nodes = uniq([...o.shared, ...me.nodes.filter((n) => them.nodes.includes(n))]);
    const candidates = [ctx.candidate.id, other.id];
    let report: ConflictReport | null = null;

    if (paths.length) {
      report = { kind: "file", candidates, nodes, paths, subjects: uniq([...paths, ...nodes]), message: `Both candidates change ${paths.join(", ")}.` };
    } else if (nodes.length || o.viaCriteria.length) {
      const hard = nodes.length ? await hardSemantic(ctx, me, them, deps) : null;
      if (hard && "rules" in hard) {
        const hn = uniq([...nodes, ...hard.nodes]);
        report = { kind: "hard-semantic", candidates, nodes: hn, paths: [], subjects: uniq([...hn, ...o.viaCriteria]), message: `Composed, the candidates violate ${hard.rules.join("; ")}.` };
      } else {
        if (hard && "note" in hard) notes.push(hard.note);
        const what = [nodes.length && `nodes ${nodes.join(", ")}`, o.viaCriteria.length && `criteria ${o.viaCriteria.join(", ")}`].filter(Boolean).join(" and ");
        report = { kind: "soft-semantic", candidates, nodes, paths: [], subjects: uniq([...nodes, ...o.viaCriteria]), message: `Different files, but both touch ${what}.` };
      }
    }
    if (!report) continue;
    if (notes.length) report.message += ` (${notes.join("; ")})`;
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
