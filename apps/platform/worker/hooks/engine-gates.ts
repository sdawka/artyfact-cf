/**
 * Gates on the ontology engine (docs/design/ontology.md §1, "Evaluate and judge, for the gates"):
 * - the Genome as an engine `Graph` (a v2 tree through `readTree`; a v1 Genome through the transitional v1 adapter),
 *   evaluated against the template it pins;
 * - `engineRules`: the rules part of every `model-rules` hook (`inputs.packs` / `inputs.rulePrefix` select findings);
 * - checks@1 (`inputs.packs` naming `checks`): deterministic checks and System One check questions on the changed nodes
 *   and their parents only.
 * text@1 findings never fail a hook: they are reported as `advisory`.
 */
import {
  ARTYFACT_GENOME, checkQuestions, CORE_PACKS, checksPack, evaluate, judge, loadArtyfactSystem, QuestionSchema, readTree,
  type ArtyfactTemplateStore, type Finding, type Graph, type Readiness, type SystemOne, type Template,
} from "@artyfact/ontology";
import { composeTemplate, loadMetaTemplate, metaTemplates, templates as v1Templates } from "@artyfact/templates";
import type { FileMap } from "./contract";
import { selectableRules, type RulesFilter } from "./model-rules";
import type { Outcome } from "./provenance";

const NODE_FILE = "node.yaml";
const PREFIX = "system/";
const TEXT_PACK = "text@1";
const CHECKS = "checks";

export interface EngineRun {
  graph: Graph;
  template: Template;
  readiness: Readiness;
}

/** Genome-relative files: a Genome stored under `system/` (v1 `system.yaml` or v2 root `node.yaml`) loses the prefix. */
function genomeFiles(files: FileMap): Record<string, string> {
  if (NODE_FILE in files || "system.yaml" in files) return files;
  if (!(`${PREFIX}${NODE_FILE}` in files) && !(`${PREFIX}system.yaml` in files)) return files;
  return Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(PREFIX)).map(([p, t]) => [p.slice(PREFIX.length), t]));
}

/** The Genome as an engine graph. W4's projection replaces the v1 branch. */
export function genomeGraph(files: FileMap): Graph {
  const g = genomeFiles(files);
  if (NODE_FILE in g) return readTree(g, metaTemplates);
  // The bundled v1 store is the adapter's template shape (both are the v1 schema).
  return loadArtyfactSystem(g, { templates: v1Templates as unknown as ArtyfactTemplateStore });
}

/** The template the graph pins: its System template (else the graph's own) with the Thing templates it uses laid over it. */
export function templateOf(g: Graph): Template {
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const pinned = (k: string) => [...new Set(g.links.filter((l) => l.rel === "pinned" && kind.get(l.from) === k && l.to.startsWith("template.")).map((l) => l.to))].sort();
  const system = pinned("system")[0] ?? g.template;
  const things = pinned("thing");
  return things.length ? composeTemplate(system, things) : loadMetaTemplate(system);
}

/** Evaluates the Genome against its template. The graph is evaluated as an instance of that (possibly composed) template. */
export function engineRun(files: FileMap): EngineRun {
  const graph = genomeGraph(files);
  const template = templateOf(graph);
  const judged = { ...graph, template: template.ref };
  return { graph: judged, template, readiness: evaluate(template, judged) };
}

const packName = (p: { id: string; version: string }) => `${p.id}@${p.version}`;
const isText = (f: Finding) => f.pack === TEXT_PACK;
const isChecks = (f: Finding) => f.pack === `${CHECKS}@1`;

/** A wanted pack matches by `id@version` or `id`; the ported artyfact packs also answer to their v1 names (`readiness@1`). */
function packMatches(wanted: string, p: { id: string; version: string }): boolean {
  const ids = [p.id, p.id.replace(/^artyfact\./, "")];
  return ids.some((id) => wanted === id || wanted === `${id}@${p.version}`);
}

function packsOf(t: Template) {
  const checks = checksPack(t);
  return [...CORE_PACKS, ...(checks ? [checks] : []), ...t.rules].map((p) => ({ id: p.id, version: String(p.version), source: p.source }));
}

const observe = (f: Finding) => ({ level: f.level, rule: f.rule, subject: f.subject, message: f.message, pack: f.pack, facts: f.facts, ...(f.judgment && { judgment: f.judgment }), ...(f.provenance && { provenance: f.provenance }) });
const advisory = (fs: Finding[]) => (fs.length ? [{ kind: "advisory", findings: fs.map(observe) }] : []);
const key = (f: Finding) => `${f.rule} ${f.subject ?? ""}`.trim();

function provenanceOf(r: EngineRun): Record<string, unknown> {
  return { snapshotHash: r.readiness.snapshotHash, template: `${r.template.ref}:${r.template.hash.slice(0, 12)}`, packs: r.readiness.packs.map((p) => `${p.id}@${p.version}:${p.hash.slice(0, 12)}`).join(",") };
}

/**
 * The rules part of a `model-rules` hook: fail on any `error` finding of the selected packs (text@1 excepted), unknown
 * when the run is incomplete, a wanted pack did not run, or a rule prefix selects nothing; pass otherwise.
 */
export function engineRules(r: EngineRun, filter?: RulesFilter): Outcome {
  const packs = packsOf(r.template);
  const wanted = filter?.packs ?? [];
  const selected = wanted.length ? packs.filter((p) => wanted.some((w) => packMatches(w, p))) : packs;
  const notRun = wanted.filter((w) => !packs.some((p) => packMatches(w, p)));
  const names = new Set(selected.map(packName));
  const findings = r.readiness.findings.filter((f) => f.pack !== undefined && names.has(f.pack) && (!filter?.rulePrefix || f.rule.startsWith(filter.rulePrefix)));
  const errors = findings.filter((f) => f.level === "error" && !isText(f));
  const selectsNothing = filter?.rulePrefix !== undefined && selectableRules(selected, { rulePrefix: filter.rulePrefix }).length === 0;

  let verdict: Outcome["verdict"];
  let interpretation: string;
  if (errors.length) {
    verdict = "fail";
    interpretation = `${errors.length} hard violation(s): ${errors.map(key).join("; ")}.`;
  } else if (notRun.length) {
    verdict = "unknown";
    interpretation = `The hook asks for pack(s) ${notRun.join(", ")}, which the template ${r.template.ref} does not run.`;
  } else if (selectsNothing) {
    verdict = "unknown";
    interpretation = `The hook's rule filter ${JSON.stringify(filter)} selects no rule in the template's packs; nothing was checked.`;
  } else if (r.readiness.incomplete) {
    verdict = "unknown";
    interpretation = "The rules run hit its iteration cap; results are incomplete.";
  } else {
    verdict = "pass";
    interpretation = `No hard violations across ${selected.length} pack(s).`;
  }
  return {
    execution: "completed",
    verdict,
    observations: [
      { kind: "readiness", snapshotHash: r.readiness.snapshotHash, template: r.template.ref, packs: [...names], incomplete: r.readiness.incomplete, actionable: r.readiness.actionable, ...(filter && { filter }) },
      ...findings.filter((f) => !isText(f)).map((f) => ({ ...observe(f), derivation: f.derivation })),
      ...advisory(findings.filter(isText)),
      ...(notRun.length ? [{ kind: "packs-not-run", packs: notRun, ran: packs.map(packName) }] : []),
    ],
    interpretation,
    limitations: r.readiness.incomplete ? ["Rules run incomplete (iteration cap)."] : [],
    provenance: provenanceOf(r),
  };
}

/** Whether a hook's filter selects checks@1, so its checks are judged on changed nodes. */
export const wantsChecks = (filter?: RulesFilter): boolean => !!filter?.packs?.some((w) => packMatches(w, { id: CHECKS, version: "1" }));

/** Changed nodes and their parents, the only subjects whose checks a gate judges. */
export function checkScope(g: Graph, changed: string[]): Set<string> {
  const parent = new Map(g.nodes.map((n) => [n.id, n.parent]));
  const scope = new Set<string>();
  for (const id of changed) {
    if (!parent.has(id)) continue;
    scope.add(id);
    const p = parent.get(id);
    if (p !== undefined) scope.add(p);
  }
  return scope;
}

/** A pair subject (`a|b`) is in scope when either side is. */
const inScope = (scope: Set<string>, f: Finding) => (f.subject ?? "").split("|").some((s) => scope.has(s));

/** The template with one System One question per semantic check (the funnel's `check:<kind>.<id>`). */
function withCheckQuestions(t: Template): Template {
  const own = new Set(t.questions.map((q) => q.id));
  const added = checkQuestions(t as Parameters<typeof checkQuestions>[0]).filter((q) => !own.has(q.id)).map((q) => QuestionSchema.parse(q));
  return { ...t, questions: [...t.questions, ...added] };
}

/**
 * checks@1 on the changed nodes and their parents: deterministic misses and judged check questions at `error` or
 * `warning` fail; an unjudged or unconfident check is unknown; `info` misses and text@1 findings are advisory. Nodes
 * outside the scope are never asked about.
 */
export async function judgeChecks(r: EngineRun, changed: string[], s1: SystemOne): Promise<Outcome> {
  const provenance = provenanceOf(r);
  if (!packsOf(r.template).some((p) => p.id === CHECKS)) {
    return { execution: "completed", verdict: "unknown", observations: [], interpretation: `The template ${r.template.ref} declares no checks.`, limitations: ["No checks to run."], provenance };
  }
  const scope = checkScope(r.graph, changed);
  const unmapped = changed.filter((id) => !scope.has(id));
  const scoped = r.readiness.findings.filter((f) => inScope(scope, f));
  const candidates = scoped.filter((f) => isChecks(f) && f.rule.startsWith("semantic:"));
  const misses = scoped.filter((f) => isChecks(f) && !f.rule.startsWith("semantic:"));
  const text = scoped.filter(isText);
  // The defect funnel (pair, section and term questions over the changed nodes) would run here; it is not wired.
  const run = candidates.length ? await judge({ ...r.readiness, findings: candidates }, withCheckQuestions(r.template), r.graph, s1) : undefined;
  const judged = run?.findings ?? [];
  const checks = [...misses, ...judged];
  const failing = checks.filter((f) => f.level === "error" || f.level === "warning");
  const open = judged.filter((f) => f.judgment?.status !== "confident");
  const providers = [...new Set(judged.map((f) => f.provenance?.provider).filter((p): p is string => !!p))];
  const models = [...new Set(judged.map((f) => f.provenance?.model).filter((m): m is string => !!m))];

  const verdict: Outcome["verdict"] = failing.length ? "fail" : open.length ? "unknown" : "pass";
  const interpretation = failing.length ? `${failing.length} check(s) not met on changed nodes: ${failing.map(key).join("; ")}.`
    : open.length ? `${open.length} check(s) on changed nodes could not be judged confidently.`
      : checks.length ? `All ${checks.length} check(s) on ${scope.size} changed node(s) and their parents are met.`
        : `No checks apply to the ${scope.size} changed node(s) and their parents.`;
  return {
    execution: "completed",
    verdict,
    observations: [
      { kind: "checks-scope", nodes: [...scope].sort(), ...(unmapped.length && { notInGraph: unmapped }) },
      ...checks.filter((f) => f.level !== "info").map(observe),
      ...advisory([...checks.filter((f) => f.level === "info"), ...text]),
    ],
    interpretation,
    limitations: [
      ...(checks.length ? [] : ["vacuous: no checks apply to the changed nodes; nothing was judged"]),
      ...(providers.some((p) => p === "off" || p === "error") ? ["System One was off or failed for some checks; those are unknown."] : []),
    ],
    provenance: { ...provenance, ...(run && { provider: providers.join(",") || "none", model: models.join(",") || "none", calls: run.judgments.calls }) },
  };
}
