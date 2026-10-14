import { BASE_TEMPLATE, GenomeTreeError, hashOf, parseTree, TemplateSourceSchema, refOf, type TemplateStore } from "@artyfact/ontology";
import { readIntentSources, type FileMap, type IntentFidelity, type IntentSources } from "./intent.ts";

export type IntegrityStatus = "blocked" | "needs-review" | "passed";
export type AgreementStatus = "pending" | "accepted" | "accepted-with-dispositions" | "rejected";
export type IntegritySectionStatus = IntegrityStatus | "not-run" | "unknown";

export interface IntegrityFinding {
  id: string;
  section: "structural" | "semantic" | "intent";
  severity: "blocked" | "review" | "warning" | "info";
  code: string;
  message: string;
  subjects: string[];
  sourceStatements?: string[];
  evidence: string[];
  suggestion?: string;
}

export interface TemplateClosureMember { ref: string; hash: string; extends?: string }
export interface IntegritySnapshot {
  version: 1;
  systemId: string;
  hash: string;
  genomeHash: string;
  files: FileMap;
  intent: IntentSources;
  templateClosure: TemplateClosureMember[];
  templateClosureHash: string;
  staticFindings: IntegrityFinding[];
}
export interface CreateIntegritySnapshotInput { systemId: string; files: FileMap; templates: TemplateStore }
export const TEMPLATE_CLOSURE_MAX = 256;

export interface IntegritySection {
  status: IntegritySectionStatus;
  complete: boolean;
  findings: IntegrityFinding[];
  checkedSubjects: string[];
  checkedRelationships: string[];
  limitations: IntegrityFinding[];
}
export interface IntegrityBudget { requestedCalls: number; maxCalls: number; usedCalls: number }
export interface IntegrityFailure { code: string; message: string }
export interface IntegrityProvenance {
  provider: string;
  model: string;
  questions: string[];
  thresholds: Record<string, number>;
  budget: IntegrityBudget;
  truncated: boolean;
  fake: boolean;
  retries: number;
  failure?: IntegrityFailure;
}
export interface IntegritySemanticSection extends IntegritySection {
  intentFidelity: IntentFidelity;
  provenance?: IntegrityProvenance;
}
export interface IntegrityReport {
  version: 1;
  id: string;
  systemId: string;
  snapshotHash: string;
  policyVersion: string;
  createdAt: string;
  status: IntegrityStatus;
  structural: IntegritySection;
  semantic: IntegritySemanticSection;
}
export interface IntegrityDisposition {
  findingId: string;
  decision: "accepted" | "rejected" | "repaired" | "deferred";
  actor: string;
  at: string;
  reportId: string;
  snapshotHash: string;
  rationale: string;
}
export interface AgreementEligibility {
  eligible: boolean;
  status: AgreementStatus;
  unresolvedFindingIds: string[];
  reason?: string;
}

const finding = (input: Omit<IntegrityFinding, "id" | "subjects" | "evidence"> & { subject?: string; evidence?: string[] }): IntegrityFinding => ({
  id: `integrity.${hashOf([input.section, input.code, input.subject ?? null, input.message])}`,
  section: input.section,
  severity: input.severity,
  code: input.code,
  message: input.message,
  subjects: input.subject === undefined ? [] : [input.subject],
  evidence: input.evidence ?? [],
  ...(input.suggestion !== undefined && { suggestion: input.suggestion }),
  ...(input.sourceStatements !== undefined && { sourceStatements: input.sourceStatements }),
});

const sortedFiles = (files: FileMap): FileMap => Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));

/** Creates a pure, serializable content snapshot. Storage IDs and timestamps belong to the platform wrapper. */
export function createIntegritySnapshot({ systemId, files: supplied, templates }: CreateIntegritySnapshotInput): IntegritySnapshot {
  const files = sortedFiles(supplied);
  let intent = readIntentSources(files);
  const genomeFiles = Object.fromEntries(Object.entries(files).filter(([path]) => path !== "intent/brief.md" && path !== "intent/manifest.json"));
  const genomeHash = `sha256:${hashOf(Object.entries(genomeFiles))}`;
  const staticFindings: IntegrityFinding[] = [];
  const roots: string[] = [];
  let genomeIds: Set<string> | undefined;

  try {
    const tree = parseTree(genomeFiles);
    genomeIds = new Set<string>();
    for (const node of tree.nodes.values()) {
      genomeIds.add(node.id);
      for (const criterion of node.file.criteria ?? []) {
        genomeIds.add(criterion.id);
        for (const hook of criterion.hooks ?? []) if (typeof hook !== "string") genomeIds.add(hook.id);
      }
    }
    for (const evolution of tree.evolutions) genomeIds.add(evolution.evolution.id);
    if (tree.root !== systemId) staticFindings.push(finding({
      section: "structural", severity: "blocked", code: "system.mismatch",
      message: `snapshot System ${systemId} does not match Genome root ${tree.root}`, subject: tree.root,
    }));
    for (const node of tree.nodes.values()) if (node.file.template !== undefined) roots.push(node.file.template);
    if (tree.nodes.get(tree.root)?.file.template === undefined) roots.push(BASE_TEMPLATE);
  } catch (error) {
    if (error instanceof GenomeTreeError) for (const problem of error.issues) staticFindings.push(finding({
      section: "structural", severity: "blocked", code: "genome.invalid", message: problem.message, subject: problem.path,
    }));
    else staticFindings.push(finding({
      section: "structural", severity: "blocked", code: "genome.invalid", message: (error as Error).message,
    }));
  }

  if (intent.fidelity === "unchecked") {
    const mappingIssues = [] as IntentSources["issues"];
    if (genomeIds === undefined) mappingIssues.push({ code: "schema", path: "intent/manifest.json", message: "manifest mappings cannot be checked against an invalid Genome", severity: "blocked" });
    else {
      const headings = new Set<string>();
      for (const line of intent.brief!.split(/\r?\n/)) {
        const match = /^(?: {0,3})#{1,6}[\t ]+(.+?)[\t ]*#*[\t ]*$/.exec(line);
        if (match) headings.add(match[1]!.trim());
      }
      for (const source of intent.manifest!.nodes) {
        if (!genomeIds.has(source.nodeId)) mappingIssues.push({ code: "node", path: "intent/manifest.json", message: `manifest references unknown node ${source.nodeId}`, severity: "blocked" });
        for (const section of source.briefSections) if (!headings.has(section)) mappingIssues.push({ code: "section", path: "intent/manifest.json", message: `manifest references unknown brief section ${JSON.stringify(section)}`, severity: "blocked" });
      }
    }
    intent = { ...intent, issues: [...intent.issues, ...mappingIssues], fidelity: mappingIssues.length ? "invalid" : "checked" };
  }
  for (const entry of intent.issues) staticFindings.push(finding({
    section: "intent",
    severity: entry.severity,
    code: `intent.${entry.code}`,
    message: entry.message,
    subject: entry.path,
  }));

  const closure = new Map<string, TemplateClosureMember>();
  const pending = [...new Set(roots)].sort();
  const visited = new Set<string>();
  while (pending.length) {
    if (visited.size >= TEMPLATE_CLOSURE_MAX) {
      staticFindings.push(finding({
        section: "structural", severity: "blocked", code: "template.limit",
        message: `reachable template closure exceeds ${TEMPLATE_CLOSURE_MAX} members`,
      }));
      break;
    }
    const ref = pending.shift()!;
    if (visited.has(ref)) continue;
    visited.add(ref);
    let raw: unknown;
    try { raw = templates.get(ref); }
    catch (error) {
      staticFindings.push(finding({ section: "structural", severity: "blocked", code: "template.resolution", message: (error as Error).message, subject: ref }));
      continue;
    }
    if (raw === undefined) {
      staticFindings.push(finding({ section: "structural", severity: "blocked", code: "template.missing", message: `template ${ref} is unavailable`, subject: ref }));
      continue;
    }
    const parsed = TemplateSourceSchema.safeParse(raw);
    if (!parsed.success) {
      staticFindings.push(finding({ section: "structural", severity: "blocked", code: "template.invalid", message: parsed.error.issues.map((entry) => entry.message).join("; "), subject: ref }));
      continue;
    }
    const actualRef = refOf(parsed.data);
    if (actualRef !== ref) {
      staticFindings.push(finding({ section: "structural", severity: "blocked", code: "template.mismatch", message: `resolver returned ${actualRef} for ${ref}`, subject: ref }));
      continue;
    }
    closure.set(ref, { ref, hash: `sha256:${hashOf(parsed.data)}`, ...(parsed.data.extends !== undefined && { extends: parsed.data.extends }) });
    if (parsed.data.extends !== undefined) pending.push(parsed.data.extends);
    pending.sort();
  }
  const cyclic = new Set<string>();
  for (const start of closure.keys()) {
    const path = new Set<string>();
    for (let ref: string | undefined = start; ref !== undefined && closure.has(ref); ref = closure.get(ref)?.extends) {
      if (path.has(ref)) { cyclic.add(ref); break; }
      path.add(ref);
    }
  }
  for (const ref of [...cyclic].sort()) staticFindings.push(finding({
    section: "structural", severity: "blocked", code: "template.cycle", message: `template lineage contains a cycle at ${ref}`, subject: ref,
  }));
  const templateClosure = [...closure.values()].sort((left, right) => left.ref.localeCompare(right.ref));
  const templateClosureHash = `sha256:${hashOf(templateClosure)}`;
  const identity = { version: 1, systemId, genomeHash, intentHash: intent.hash, templateClosureHash };
  return {
    version: 1,
    systemId,
    hash: `sha256:${hashOf(identity)}`,
    genomeHash,
    files,
    intent,
    templateClosure,
    templateClosureHash,
    staticFindings: staticFindings.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

const requiresReview = (entry: IntegrityFinding): boolean => entry.severity === "review" || entry.severity === "warning";
const blocks = (entry: IntegrityFinding): boolean => entry.severity === "blocked";

/** Recomputes status from evidence instead of trusting the report's cached status field. */
export function integrityStatus(report: IntegrityReport): IntegrityStatus {
  const structuralItems = [...report.structural.findings, ...report.structural.limitations];
  if (!report.structural.complete || report.structural.status === "blocked" || report.structural.status === "not-run" || report.structural.status === "unknown" || structuralItems.some(blocks)) return "blocked";
  if (report.semantic.status === "blocked" || [...report.semantic.findings, ...report.semantic.limitations].some(blocks)) return "blocked";
  if (report.structural.status === "needs-review") return "needs-review";
  if (report.semantic.status !== "passed" || !report.semantic.complete || report.semantic.intentFidelity !== "checked") return "needs-review";
  const provenance = report.semantic.provenance;
  if (provenance?.fake || provenance?.provider === "off" || provenance?.failure !== undefined || provenance?.truncated) return "needs-review";
  if (structuralItems.some(requiresReview) || [...report.semantic.findings, ...report.semantic.limitations].some(requiresReview)) return "needs-review";
  return "passed";
}

const NON_DISPOSITIONABLE = new Set(["provider.off", "provider.transport", "semantic.not-run"]);
const reviewItems = (report: IntegrityReport): IntegrityFinding[] =>
  [...report.structural.findings, ...report.structural.limitations, ...report.semantic.findings, ...report.semantic.limitations]
    .filter(requiresReview);

/** Determines whether the exact report/snapshot may receive a separate human agreement record. */
export function agreementEligibility(report: IntegrityReport, dispositions: readonly IntegrityDisposition[]): AgreementEligibility {
  const automated = integrityStatus(report);
  if (automated === "blocked") return { eligible: false, status: "pending", unresolvedFindingIds: [], reason: "structural repair and a new report are required" };
  if (automated === "passed") return { eligible: true, status: "accepted", unresolvedFindingIds: [] };
  const items = reviewItems(report);
  const provenance = report.semantic.provenance;
  if (report.semantic.status === "not-run" || report.semantic.status === "unknown" || report.semantic.intentFidelity !== "checked"
    || provenance?.fake || provenance?.provider === "off" || provenance?.failure !== undefined
    || items.some((entry) => NON_DISPOSITIONABLE.has(entry.code))) {
    return { eligible: false, status: "pending", unresolvedFindingIds: items.map((entry) => entry.id), reason: "semantic evaluation must be completed or retried" };
  }
  const findingIds = new Set(items.map((entry) => entry.id));
  const applicable = dispositions.filter((entry) => findingIds.has(entry.findingId) && entry.reportId === report.id && entry.snapshotHash === report.snapshotHash && entry.rationale.trim() !== "");
  if (applicable.some((entry) => entry.decision === "rejected")) return { eligible: false, status: "rejected", unresolvedFindingIds: items.map((entry) => entry.id) };
  const unresolvedFindingIds = items.filter((item) => !applicable.some((entry) => entry.findingId === item.id && entry.decision === "accepted")).map((item) => item.id);
  if (!items.length || unresolvedFindingIds.length) return { eligible: false, status: "pending", unresolvedFindingIds, reason: "every review item requires an exact accepted disposition and rationale" };
  return { eligible: true, status: "accepted-with-dispositions", unresolvedFindingIds: [] };
}
