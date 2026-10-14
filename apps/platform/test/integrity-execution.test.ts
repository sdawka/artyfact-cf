import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { agreementEligibility, createIntegritySnapshot } from "@artyfact/model";
import type { Answer, S1Questions, SystemOne } from "@artyfact/ontology";
import { assertIntegritySnapshotCurrent, executeIntegrity, providerForIntegrityRun, resolveIntegrityProvider } from "../worker/integrity/execution";
import { IntegrityStore } from "../worker/integrity/store";
import { acceptedTemplateResolver, OntologyPackagesStore } from "../worker/ontology-packages/store";

const cleanModules = import.meta.glob("../../../examples/intent-integrity/clean/genome/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import cleanPackageText from "../../../examples/intent-integrity/clean/ontology-package.json?raw";

const filesFrom = (modules: Record<string, string>, marker: string): Record<string, string> =>
  Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split(marker)[1]!, text]));

function provider(asked: string[], omitted = false, followPairs = false, uncertainIntent = false): SystemOne {
  return {
    mode: "fake", model: "integrity-test",
    async ask(_state: unknown, questions: S1Questions) {
      asked.push(...Object.keys(questions));
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]): [string, Answer] => {
        if (question.type === "noul") return [id, { type: "noul", noul: id.startsWith("intent.") && uncertainIntent ? 0.6 : id === "intent.omitted" && omitted ? 0.95 : 0.05 }];
        if (question.type === "choice") {
          const dynamic = followPairs && ["set.member", "sections.which", "sections.section", "sections.other"].includes(id)
            ? Object.keys(question.criteria).find((choice) => choice !== "none") : undefined;
          const choice = dynamic ?? question.benign ?? Object.keys(question.criteria)[0]!;
          return [id, { type: "choice", choice, probabilities: { [choice]: 1 }, confidence: 1 }];
        }
        const score = question.benign ?? question.criteria.length - 1;
        return [id, { type: "score", score, probabilities: { [String(score)]: 1 }, confidence: 1 }];
      }));
      return { answers, model: "integrity-test", provider: "test-fake", ms: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

async function execute(systemId: string, files: Record<string, string>, s1: SystemOne, pkg?: unknown) {
  return runInDurableObject(env.SYSTEMS.getByName(systemId), async (_authority, state) => {
    const packages = new OntologyPackagesStore(state.storage.sql);
    packages.initialize(systemId);
    if (pkg && packages.acceptedPackages().length === 0) {
      const preview = packages.preview(systemId, { package: pkg, genomeFiles: files });
      if (!preview.pin) throw new Error(preview.issues.map((issue) => issue.message).join("; "));
      packages.accept(preview.id, preview.pin.hash);
    }
    const accepted = packages.acceptedPackages();
    const templates = acceptedTemplateResolver(accepted).templates;
    const store = new IntegrityStore(state.storage.sql, systemId);
    const snapshot = store.putSnapshot(createIntegritySnapshot({ systemId, files, templates }), "initial-preview");
    const started = store.start(snapshot.id, { snapshotId: snapshot.id, provider: "auto", budget: { maxCalls: 200 } }, {
      provider: s1.mode === "fake" ? "fake" : s1.mode === "off" ? "off" : "typesafe", model: s1.model,
    }).run;
    const lease = store.lease();
    if (!lease) throw new Error("integrity run was not leasable");
    const report = await executeIntegrity({} as Env, store, started, snapshot, accepted, s1, lease.token);
    return store.complete(started.id, lease.token, report);
  });
}

it("reports an omitted requirement from provider output and labels simulated evidence", async () => {
  const files = filesFrom(cleanModules, "/clean/genome/");
  files["intent/brief.md"] += "\nA material audit export is also required.";
  const manifest = JSON.parse(files["intent/manifest.json"]!) as { nodes: Array<{ documents: Array<{ path: string; hash: string }> }> };
  manifest.nodes[0]!.documents.push({ path: "docs/private-requirements.md", hash: `sha256:${"a".repeat(64)}` });
  files["intent/manifest.json"] = JSON.stringify(manifest);
  const pkg = JSON.parse(cleanPackageText);
  const asked: string[] = [];
  const run = await execute("system.tool-library", files, provider(asked, true), pkg);
  expect(run.report?.semantic.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "intent.omitted-requirement", section: "intent", severity: "review" }),
  ]));
  expect(run.report?.semantic.limitations).toEqual(expect.arrayContaining([expect.objectContaining({ code: "provider.simulated" })]));
  expect(run.report?.semantic.limitations).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "intent.source-unverified", subjects: ["docs/private-requirements.md"] }),
  ]));
  expect(run.report?.status).toBe("needs-review");
});

it("sends relationship, section, and terminology candidates through the production semantic funnel", async () => {
  const files = filesFrom(cleanModules, "/clean/genome/");
  const operation = files["thing.library/operation.request-tool/node.yaml"]!;
  const policy = files["thing.library/policy.privacy/node.yaml"]!;
  delete files["thing.library/operation.request-tool/node.yaml"];
  delete files["thing.library/policy.privacy/node.yaml"];
  files["section.requests/node.yaml"] = JSON.stringify({ id: "section.requests", kind: "section", fields: { name: "Requests", description: "Neighbour requests and owner decisions for a shared tool." } });
  files["section.requests/operation.request-tool/node.yaml"] = operation;
  files["section.privacy/node.yaml"] = JSON.stringify({ id: "section.privacy", kind: "section", fields: { name: "Privacy", description: "Neighbour privacy and owner-only contact details for every shared tool." } });
  files["section.privacy/policy.privacy/node.yaml"] = policy;
  const asked: string[] = [];
  const run = await execute("system.tool-library", files, provider(asked, false, true), JSON.parse(cleanPackageText));
  expect(run.state).toBe("completed");
  expect(asked.some((id) => id.startsWith("pair.")), JSON.stringify({ asked, limitations: run.report?.semantic.limitations })).toBe(true);
  expect(asked.some((id) => id.startsWith("sections.")), JSON.stringify(asked)).toBe(true);
  expect(asked.some((id) => id.startsWith("term.")), JSON.stringify(asked)).toBe(true);
  expect(run.report?.semantic.provenance?.questions).toEqual(expect.arrayContaining(asked));
  expect(run.report?.semantic.checkedRelationships.some((relationship) => relationship.startsWith("pair:"))).toBe(true);
  expect(run.report?.semantic.findings.some((finding) => finding.severity === "blocked")).toBe(false);
});

it("freezes the resolved provider selection and refuses changed execution configuration", () => {
  const selected = resolveIntegrityProvider({ TYPESAFE_API_KEY: "first" } as Env, { provider: "auto" });
  expect(selected).toEqual({ provider: "typesafe", model: "jev-latest" });
  const run = { resolvedProvider: selected.provider, resolvedModel: selected.model } as Parameters<typeof providerForIntegrityRun>[1];
  expect(() => providerForIntegrityRun({ OPENROUTER_API_KEY: "second" } as Env, run)).toThrow(/provider configuration changed/);
});

it("keeps uncertain direct intent judgments out of passing evidence", async () => {
  const files = filesFrom(cleanModules, "/clean/genome/");
  const run = await execute("system.tool-library", files, provider([], false, false, true), JSON.parse(cleanPackageText));
  expect(run.report?.semantic.limitations).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "intent.judgment-unknown" }),
  ]));
  expect(run.report?.status).toBe("needs-review");
});

it("refuses to execute when the reachable template closure drifted after preview", () => {
  const systemId = "system.template-drift";
  const files = {
    "node.yaml": `id: ${systemId}\nkind: system\ntemplate: template.system.drift@1\nfields: { name: Drift }\n`,
  };
  const source = { id: "template.system.drift", version: 1, meta: 1 };
  const snapshot = createIntegritySnapshot({ systemId, files, templates: { get: () => source } });
  expect(() => assertIntegritySnapshotCurrent(snapshot, { get: () => source })).not.toThrow();
  expect(() => assertIntegritySnapshotCurrent(snapshot, { get: () => undefined })).toThrow(/template closure changed/);
});


it("checks authored intent against policy statements and declared relationships outside descriptions", async () => {
  const files = filesFrom(cleanModules, "/clean/genome/");
  const statement = "Borrower information is never disclosed to advertisers.";
  const evolutionIntent = "Audit the privacy guarantee before any implementation begins.";
  files["thing.library/policy.privacy/node.yaml"] += `  statement: ${statement}\nlinks:\n  - rel: governs\n    to: operation.request-tool\n`;
  files["evolutions/evolution.privacy.yaml"] = [
    "id: evolution.privacy", "title: Review privacy", `intent: ${evolutionIntent}`, "state: proposed", "kind: genome-amendment",
    "affectedNodes: [policy.privacy]", "acceptanceCriteria: []",
  ].join("\n");
  const delegate = provider([]);
  let input = "";
  const observer: SystemOne = {
    ...delegate,
    async ask(state, questions, opts) {
      if ("intent.omitted" in questions) input = JSON.stringify(state);
      return delegate.ask(state, questions, opts);
    },
  };
  const run = await execute("system.tool-library", files, observer, JSON.parse(cleanPackageText));
  expect(run.report?.structural.status).not.toBe("blocked");
  expect(input).toContain(statement);
  expect(input).toContain("governs");
  expect(input).toContain(evolutionIntent);
});

it("bounds large direct intent checks to exact manifest-mapped declarations and discloses partial coverage", async () => {
  const files = filesFrom(cleanModules, "/clean/genome/");
  const statement = "Borrower information is never disclosed to advertisers.";
  const slashMappedStatement = "The borrower confirms the agreed return date.";
  files["thing.library/policy.privacy/node.yaml"] += `  statement: ${statement}\nlinks:\n  - rel: governs\n    to: operation.request-tool\n`;
  files["thing.library/J.borrow/node.yaml"] = "id: J.borrow\nkind: journey\nfields: { name: Borrow a tool, actorGoal: Borrow a tool, start: s1, deferred: false }\n";
  files["thing.library/J.borrow/s1/node.yaml"] = `id: J.borrow/s1\nkind: step\nfields: { step: s1, actor: counterpart, action: ${slashMappedStatement}, kind: end, unresolved: false }\n`;
  for (let index = 0; index < 48; index++) files[`thing.library/policy.filler-${index}/node.yaml`] = [
    `id: policy.filler-${index}`, "kind: policy", "fields:", `  name: Filler ${index}`, `  description: ${"unmapped filler ".repeat(55)}${index}`,
  ].join("\n");
  files["intent/manifest.json"] = JSON.stringify({ version: 1, nodes: [{
    nodeId: "policy.privacy", briefSections: ["boundaries"], documents: [],
  }, {
    nodeId: "J.borrow/s1", briefSections: ["acceptance"], documents: [],
  }] });
  let direct: unknown;
  const delegate = provider([]), observer: SystemOne = {
    ...delegate,
    async ask(state, questions, opts) {
      if ("intent.omitted" in questions) direct = state;
      return delegate.ask(state, questions, opts);
    },
  };
  const run = await execute("system.tool-library", files, observer, JSON.parse(cleanPackageText));
  expect(direct, JSON.stringify(run.report)).toBeDefined();
  const serialized = JSON.stringify(direct);
  expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(24 * 1024);
  expect(serialized).toContain(statement);
  expect(serialized).toContain(slashMappedStatement);
  expect(serialized).toContain("governs");
  expect(serialized).not.toContain("policy.filler-47");
  expect(direct).toMatchObject({ scope: { mode: "manifest-mapped", totalDeclarations: 54, coveredDeclarations: 2 } });
  expect(run.report?.semantic.limitations).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "intent.coverage-limited", subjects: ["policy.privacy", "J.borrow/s1"] }),
  ]));
  expect(run.report?.status).toBe("needs-review");
});

it("skips an oversized mapped intent context but still runs the per-node semantic funnel", async () => {
  const files = filesFrom(cleanModules, "/clean/genome/");
  files["intent/brief.md"] = `# enormous\n\n${"exact requirement ".repeat(1900)}\n`;
  files["intent/manifest.json"] = JSON.stringify({ version: 1, nodes: [{
    nodeId: "operation.request-tool", briefSections: ["enormous"], documents: [],
  }] });
  const asked: string[] = [];
  const run = await execute("system.tool-library", files, provider(asked, false, true), JSON.parse(cleanPackageText));
  expect(asked.some((id) => id.startsWith("intent."))).toBe(false);
  expect(asked.some((id) => !id.startsWith("intent.")), JSON.stringify(run.report)).toBe(true);
  const notRun = run.report!.semantic.limitations.find((finding) => finding.code === "intent.not-run")!;
  expect(notRun).toMatchObject({ severity: "review", subjects: ["operation.request-tool"] });
  const disposition = {
    findingId: notRun.id, decision: "accepted" as const, actor: "admin", at: new Date().toISOString(),
    reportId: run.report!.id, snapshotHash: run.snapshotHash, rationale: "Accept the missing global check.",
  };
  expect(agreementEligibility(run.report!, [disposition])).toMatchObject({ eligible: false, status: "pending" });
  expect(run.report?.semantic.provenance).toMatchObject({ provider: "simulated", model: "integrity-test" });
});
