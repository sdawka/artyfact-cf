import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { createIntegritySnapshot } from "@artyfact/model";
import type { Answer, S1Questions, SystemOne } from "@artyfact/ontology";
import { executeIntegrity } from "../worker/integrity/execution";
import { IntegrityStore } from "../worker/integrity/store";
import { acceptedTemplateResolver, OntologyPackagesStore } from "../worker/ontology-packages/store";

const cleanModules = import.meta.glob("../../../examples/intent-integrity/clean/genome/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import cleanPackageText from "../../../examples/intent-integrity/clean/ontology-package.json?raw";

const filesFrom = (modules: Record<string, string>, marker: string): Record<string, string> =>
  Object.fromEntries(Object.entries(modules).map(([path, text]) => [path.split(marker)[1]!, text]));

function provider(asked: string[], omitted = false, followPairs = false): SystemOne {
  return {
    mode: "fake", model: "integrity-test",
    async ask(_state: unknown, questions: S1Questions) {
      asked.push(...Object.keys(questions));
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]): [string, Answer] => {
        if (question.type === "noul") return [id, { type: "noul", noul: id === "intent.omitted" && omitted ? 0.95 : 0.05 }];
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
    const started = store.start(snapshot.id, { snapshotId: snapshot.id, provider: "auto", budget: { maxCalls: 200 } }).run;
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
