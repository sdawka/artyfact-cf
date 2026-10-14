import {
  createIntegritySnapshot, integrityStatus, loadGenome, readinessTemplate, type IntegrityFinding, type IntegrityReport, type IntegritySnapshot,
} from "@artyfact/model";
import {
  askCacheKey, band, CLEF_MODEL, DEFAULT_OPENROUTER_MODEL, DEFAULT_TYPESAFE_MODEL, evaluate, evaluateAndJudge, fakeSystemOne, hashOf,
  JEV_OPENROUTER_MODEL, kindGlossary, loadTemplate, offSystemOne, openRouterProvider, simulatedSystemOne, TemplateSourceSchema,
  typeSafeProvider, withSemanticProbes, workersAiProvider, type ProviderEnv, type S1Questions, type S1Reply,
  type SystemOne, type TemplateStore,
} from "@artyfact/ontology";
import {
  INTEGRITY_POLICY_VERSION, type IntegrityProviderSelection, type IntegrityRun, type IntegrityRunRequest, type StoredIntegritySnapshot,
} from "../../shared/integrity";
import { isHostedDemo } from "../demo";
import { acceptedTemplateResolver } from "../ontology-packages/store";
import { IntegrityStore } from "./store";

const findingId = (section: string, code: string, subjects: string[]) => `${section}.${hashOf({ code, subjects })}`;
const limitation = (code: string, message: string): IntegrityFinding => ({
  id: findingId("semantic", code, []), section: "semantic", severity: "review", code, message,
  subjects: [], evidence: [], suggestion: "Retry with a real provider and enough budget, then review the new exact report.",
});

interface ProviderTelemetry { provider: string; model: string; questions: Set<string>; subjects: Set<string>; relationships: Set<string>; calls: number }
const relationshipKey = (from: string, rel: string, to: string) => JSON.stringify([from, rel, to]);
function coverageIn(value: unknown, known: Set<string>, telemetry: ProviderTelemetry): void {
  if (typeof value === "string") { if (known.has(value)) telemetry.subjects.add(value); return; }
  if (Array.isArray(value)) { for (const item of value) coverageIn(item, known, telemetry); return; }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.from === "string" && typeof object.rel === "string" && typeof object.to === "string") {
    telemetry.relationships.add(relationshipKey(object.from, object.rel, object.to));
  }
  for (const item of Object.values(object)) coverageIn(item, known, telemetry);
}
function replaying(provider: SystemOne, store: IntegrityStore, runId: string, leaseToken: string, known: Set<string>, telemetry: ProviderTelemetry): SystemOne {
  const observe = (reply: S1Reply) => {
    store.assertProviderIdentity(runId, leaseToken, { provider: reply.provider, model: reply.model });
    telemetry.provider = reply.provider; telemetry.model = reply.model;
  };
  return {
    ...provider,
    async ask(state: unknown, questions: S1Questions, opts = {}): Promise<S1Reply> {
      store.assertLease(runId, leaseToken);
      Object.keys(questions).forEach((id) => telemetry.questions.add(id));
      coverageIn(state, known, telemetry);
      const slice = state as { subject?: { id?: unknown }; counterpart?: { id?: unknown } };
      if (typeof slice.subject?.id === "string" && typeof slice.counterpart?.id === "string") {
        telemetry.relationships.add(`pair:${[slice.subject.id, slice.counterpart.id].sort().join("|")}`);
      }
      telemetry.calls++;
      const key = askCacheKey(state, questions, provider.model, opts);
      const saved = store.checkpoint<S1Reply>(runId, key);
      if (saved) {
        observe(saved);
        return saved;
      }
      const reply = await provider.ask(state, questions, { ...opts, retries: 0 });
      store.assertLease(runId, leaseToken);
      observe(reply);
      store.putCheckpoint(runId, key, reply);
      return reply;
    },
  };
}

const mapFinding = (finding: {
  level: string; rule: string; subject?: string; message: string; facts?: unknown[]; judgment?: { status?: string; question?: string };
}, section: IntegrityFinding["section"] = "semantic"): IntegrityFinding => {
  const subjects = finding.subject ? [finding.subject] : [];
  const severity = section === "structural" && (finding.level === "error" || finding.level === "missing") ? "blocked"
    : ["error", "missing", "warning", "review"].includes(finding.level) || finding.judgment?.status === "unknown" ? "review" : "info";
  return {
    id: findingId(section, finding.rule, subjects), section, severity,
    code: finding.rule, message: finding.message, subjects,
    evidence: finding.facts?.slice(0, 8).map((fact) => JSON.stringify(fact)) ?? [],
    ...(finding.judgment?.question && { sourceStatements: [finding.judgment.question] }),
  };
};

export function resolveIntegrityProvider(env: Env, request: Pick<IntegrityRunRequest, "provider" | "model">): IntegrityProviderSelection {
  if (isHostedDemo(env)) return { provider: "simulated", model: "simulated" };
  const configured = env as unknown as ProviderEnv;
  if (configured.FAKE_S1 === "1") return { provider: "fake", model: "fake" };
  const choice = request.provider ?? "auto", requestedModel = request.model?.trim();
  const typeSafe = !!configured.TYPESAFE_API_KEY?.trim(), openRouter = !!configured.OPENROUTER_API_KEY?.trim();
  const clef = !!configured.AI && typeof configured.AI.run === "function";
  if (choice === "off") return { provider: "off", model: "off" };
  if (choice === "clef") return clef ? { provider: "clef", model: requestedModel || configured.CLEF_MODEL?.trim() || CLEF_MODEL } : { provider: "off", model: "off" };
  if (choice === "openrouter") return openRouter
    ? { provider: "openrouter", model: requestedModel || configured.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL }
    : { provider: "off", model: "off" };
  if (choice === "jev") {
    if (typeSafe) return { provider: "typesafe", model: requestedModel || configured.JEV_MODEL?.trim() || DEFAULT_TYPESAFE_MODEL };
    if (openRouter) {
      const model = requestedModel || configured.JEV_MODEL?.trim();
      return { provider: "openrouter", model: model ? (model.includes("/") ? model : `typesafe/${model}`) : JEV_OPENROUTER_MODEL };
    }
    return { provider: "off", model: "off" };
  }
  if (typeSafe) return { provider: "typesafe", model: configured.JEV_MODEL?.trim() || DEFAULT_TYPESAFE_MODEL };
  if (clef) return { provider: "clef", model: configured.CLEF_MODEL?.trim() || CLEF_MODEL };
  if (openRouter) return { provider: "openrouter", model: configured.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL };
  return { provider: "off", model: "off" };
}

export function providerForIntegrityRun(env: Env, run: Pick<IntegrityRun, "resolvedProvider" | "resolvedModel">): SystemOne {
  const configured = env as unknown as ProviderEnv;
  const provider = run.resolvedProvider, model = run.resolvedModel;
  if (provider === "simulated") {
    if (!isHostedDemo(env)) throw new Error("[provider-config-drift] provider configuration changed since the integrity run was queued");
    return simulatedSystemOne();
  }
  if (isHostedDemo(env)) throw new Error("[provider-config-drift] provider configuration changed since the integrity run was queued");
  if (provider === "fake") {
    if (configured.FAKE_S1 !== "1") throw new Error("[provider-config-drift] provider configuration changed since the integrity run was queued");
    return fakeSystemOne(model);
  }
  if (provider === "off") return offSystemOne("provider was off when the integrity run was queued");
  if (provider === "typesafe") {
    const apiKey = configured.TYPESAFE_API_KEY?.trim();
    if (!apiKey) throw new Error("[provider-config-drift] provider configuration changed since the integrity run was queued");
    return typeSafeProvider({ apiKey, model, fetch: configured.fetch });
  }
  if (provider === "openrouter") {
    const apiKey = configured.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error("[provider-config-drift] provider configuration changed since the integrity run was queued");
    return openRouterProvider({ apiKey, model, fetch: configured.fetch });
  }
  if (provider !== "clef" || !configured.AI || typeof configured.AI.run !== "function") {
    throw new Error("[provider-config-drift] provider configuration changed since the integrity run was queued");
  }
  return workersAiProvider(configured.AI, model);
}

export function assertIntegritySnapshotCurrent(snapshot: IntegritySnapshot, templates: TemplateStore): void {
  const current = createIntegritySnapshot({ systemId: snapshot.systemId, files: snapshot.files, templates });
  if (current.templateClosureHash !== snapshot.templateClosureHash || current.hash !== snapshot.hash) {
    throw new Error("[template-drift] reachable template closure changed after integrity preview; create a new preview and run");
  }
}

const NOUL = (instructions: string) => ({
  type: "noul" as const, instructions, benign: "no" as const,
  criteria: { true: "The defect is present.", false: "The defect is absent." },
});
function semanticTemplate(model: ReturnType<typeof loadGenome>) {
  const base = readinessTemplate(model);
  const { ref: _ref, extends: _extends, lineage: _lineage, edges: _edges, hash: _hash, ...input } = base;
  const source = TemplateSourceSchema.parse(input);
  return loadTemplate(withSemanticProbes(source, {
    texts: ["description", "statement", "text", "claim", "summary", "outcome", "intent"],
    fields: ["name", "title", "description", "statement", "text", "claim", "summary", "outcome", "intent"],
    measurable: ["claim", "criterion"], criteria: ["criterion"],
    kinds: kindGlossary(source.kinds), sets: ["screen", "component", "policy"], sections: true,
    purposeKinds: ["purpose", "claim", "commitment", "feature"], probePairs: ["governs"],
  }));
}

export async function executeIntegrity(
  env: Env, store: IntegrityStore, run: IntegrityRun, snapshot: StoredIntegritySnapshot,
  packages: Parameters<typeof acceptedTemplateResolver>[0],
  providerOverride?: SystemOne,
  leaseToken = "",
): Promise<IntegrityReport> {
  const resolver = acceptedTemplateResolver(packages);
  assertIntegritySnapshotCurrent(snapshot, resolver.templates);
  const structuralFindings = snapshot.staticFindings.filter((finding) => finding.section === "structural");
  const intentFindings = snapshot.staticFindings.filter((finding) => finding.section === "intent");
  const structural: IntegrityReport["structural"] = {
    status: structuralFindings.some((f) => f.severity === "blocked") ? "blocked" as const
      : structuralFindings.some((f) => f.severity === "review" || f.severity === "warning") ? "needs-review" as const : "passed" as const,
    complete: true, findings: structuralFindings,
    checkedSubjects: [] as string[], checkedRelationships: [] as string[], limitations: [] as IntegrityFinding[],
  };
  let model: ReturnType<typeof loadGenome> | undefined;
  if (!structuralFindings.some((finding) => finding.severity === "blocked")) {
    try {
      model = loadGenome(snapshot.files, { templates: resolver.templates });
      const evaluated = evaluate(readinessTemplate(model), model.graph);
      for (const finding of evaluated.findings) if (!finding.rule.startsWith("semantic:")) structuralFindings.push(mapFinding(finding, "structural"));
      structural.checkedSubjects = [...new Set(model.nodes.map((node) => node.id))].sort();
      structural.checkedRelationships = model.graph.links.map((link) => relationshipKey(link.from, link.rel, link.to)).sort();
    } catch (error) {
      structuralFindings.push({
        id: findingId("structural", "genome.invalid", []), section: "structural", severity: "blocked",
        code: "genome.invalid", message: (error as Error)?.message ?? String(error), subjects: [], evidence: [],
      });
    }
    structural.status = structuralFindings.some((finding) => finding.severity === "blocked") ? "blocked"
      : structuralFindings.some((finding) => finding.severity === "review" || finding.severity === "warning") ? "needs-review" : "passed";
    structural.findings = structuralFindings;
  }
  const provider = providerOverride ?? providerForIntegrityRun(env, run);
  const limitations: IntegrityFinding[] = [];
  let semanticFindings: IntegrityFinding[] = [...intentFindings];
  let checkedSubjects: string[] = [], checkedRelationships: string[] = [];
  let budget = "ok", failure: { code: string; message: string } | undefined;
  const telemetry: ProviderTelemetry = { provider: provider.mode, model: provider.model, questions: new Set(), subjects: new Set(), relationships: new Set(), calls: 0 };

  if (provider.mode === "off") {
    limitations.push(limitation("provider.off", provider.reason ?? "No semantic provider is configured."));
  } else if (structural.status !== "blocked") {
    try {
      model ??= loadGenome(snapshot.files, { templates: resolver.templates });
      const known = new Set(model.nodes.map((node) => node.id));
      const wrapped = replaying(provider, store, run.id, leaseToken, known, telemetry);
      if (snapshot.intent.fidelity === "checked") {
        const intentState = {
          brief: snapshot.intent.brief,
          manifest: snapshot.intent.manifest,
          nodes: model.nodes.map((node) => ({
            id: node.id, kind: node.kind, name: node.name,
            description: typeof node.description === "string" ? node.description.slice(0, 1000) : undefined,
          })),
        };
        const reply = await wrapped.ask(intentState, {
          "intent.omitted": NOUL("Does the authored intent contain a material requirement that the resulting nodes omit?"),
          "intent.unsupported": NOUL("Do the resulting nodes assert a material claim that the authored intent does not support?"),
        });
        const unknownIntent: string[] = [];
        for (const [key, code, message] of [
          ["intent.omitted", "intent.omitted-requirement", "A material authored requirement appears to be omitted from the Genome."],
          ["intent.unsupported", "intent.unsupported-claim", "The Genome appears to contain a material claim unsupported by authored intent."],
        ] as const) {
          const answer = reply.answers[key];
          const probability = answer?.type === "noul" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1 ? answer.noul : undefined;
          const status = probability === undefined ? "unknown" : band(Math.max(probability, 1 - probability), run.thresholds);
          if (status !== "confident") { unknownIntent.push(key); continue; }
          if (probability! >= 0.5) semanticFindings.push({
            id: findingId("intent", code, []), section: "intent", severity: "review", code, message, subjects: [],
            sourceStatements: snapshot.intent.brief ? [snapshot.intent.brief.slice(0, 2000)] : [],
            evidence: [`provider=${reply.provider}`, `model=${reply.model}`],
            suggestion: "Clarify the intent or revise the affected nodes, then run integrity again.",
          });
        }
        if (unknownIntent.length) limitations.push({
          ...limitation("intent.judgment-unknown", "One or more direct intent fidelity judgments were missing, invalid, or below the configured confidence threshold."),
          subjects: unknownIntent, evidence: unknownIntent.map((id) => `question=${id}`),
        });
      }
      const judged = await evaluateAndJudge(semanticTemplate(model), model.graph, wrapped, {
        thresholds: run.thresholds,
        limits: { maxCalls: Math.max(0, run.requestedCalls - telemetry.calls) },
      });
      for (const finding of judged.findings) {
        if (finding.judgment || finding.rule.startsWith("semantic:")) semanticFindings.push(mapFinding(finding));
        else structuralFindings.push(mapFinding(finding, "structural"));
      }
      structural.status = structuralFindings.some((f) => f.severity === "blocked") ? "blocked"
        : structuralFindings.some((f) => f.severity === "review" || f.severity === "warning") ? "needs-review" : "passed";
      structural.findings = structuralFindings;
      budget = judged.judgments?.budget ?? "ok";
      checkedSubjects = [...telemetry.subjects].sort();
      checkedRelationships = [...telemetry.relationships].sort();
      const providerError = judged.findings.find((f) => f.provenance?.error)?.provenance?.error;
      if (providerError) {
        failure = { code: providerError.code ?? "provider.transport", message: providerError.message };
        limitations.push(limitation("provider.transport", providerError.message));
      }
      if (budget === "exhausted") limitations.push(limitation("budget.exhausted", "The semantic call budget was exhausted before full coverage."));
      if (judged.judgments.calls === 0) limitations.push(limitation("semantic.not-run", "The semantic funnel had no candidates to send to the configured provider."));
    } catch (error) {
      failure = { code: "provider.transport", message: (error as Error)?.message ?? String(error) };
      limitations.push(limitation("provider.transport", failure.message));
    }
  } else {
    limitations.push(limitation("semantic.not-run", "Semantic evaluation did not run because deterministic structural blockers must be repaired first."));
  }
  if (snapshot.intent.fidelity !== "checked") {
    limitations.push(limitation("intent.fidelity", "Intent fidelity could not be checked from valid brief and manifest sidecars."));
  }
  const unverifiedDocuments = snapshot.intent.documents.filter((document) => document.status === "declared");
  if (unverifiedDocuments.length) {
    limitations.push({
      ...limitation("intent.source-unverified", "Referenced intent source documents were not present in the snapshot, so their declared hashes could not be verified."),
      subjects: unverifiedDocuments.map((document) => document.path).sort(),
      evidence: unverifiedDocuments.map((document) => `${document.path}=${document.declaredHash}`).sort(),
    });
  }
  const fake = provider.mode === "fake" || provider.model === "simulated";
  if (fake) limitations.push(limitation("provider.simulated", "Simulated judgments are inspectable but cannot establish real-provider acceptance evidence."));
  const semantic = {
    status: semanticFindings.some((f) => f.severity === "blocked") ? "blocked" as const
      : limitations.length || semanticFindings.some((f) => f.severity === "review" || f.severity === "warning") ? "needs-review" as const : "passed" as const,
    complete: !limitations.length, findings: semanticFindings, checkedSubjects, checkedRelationships, limitations,
    intentFidelity: snapshot.intent.fidelity,
    provenance: {
      provider: provider.mode === "off" ? "off" : fake ? "simulated" : telemetry.provider,
      model: telemetry.model, questions: [...telemetry.questions].sort(), thresholds: run.thresholds,
      budget: { requestedCalls: run.requestedCalls, maxCalls: 500, usedCalls: telemetry.calls },
      truncated: budget === "exhausted", fake, retries: 0, ...(failure && { failure }),
    },
  };
  const report: IntegrityReport = {
    version: 1, id: `report.${hashOf({ run: run.id, snapshot: snapshot.hash, policy: INTEGRITY_POLICY_VERSION })}`,
    systemId: snapshot.systemId, snapshotHash: snapshot.hash, policyVersion: INTEGRITY_POLICY_VERSION,
    createdAt: new Date().toISOString(), status: "needs-review", structural, semantic,
  };
  report.status = integrityStatus(report);
  return report;
}
