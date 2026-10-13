import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { dispatchPreviewBuild, requestProductionDeploy, setCiOverride, createDeployment } from "../worker/deployments";
import type { CiBuildParams, SystemCommit } from "../shared/api";
import type { SystemAuthority } from "../worker/do/system-authority";
import { genomeFiles } from "./fixtures/genome";
import { FakeArtifacts } from "./helpers/fake-artifacts";
let id: string, ns: FakeArtifacts, older: string, newer: string, source: string, params: CiBuildParams[];
const inDo = <T>(fn: (i: SystemAuthority) => T | Promise<T>) => runInDurableObject(env.SYSTEMS.getByName(id), fn);
beforeEach(async () => {
  id = `lineage-${crypto.randomUUID()}`; ns = new FakeArtifacts(); setArtifactsOverride(ns); params = [];
  setCiOverride({ create: async opts => { params.push(opts!.params!); return { id: opts!.id! } as WorkflowInstance; } });
  const repo = ns.create("demo-system"); older = repo.commit(genomeFiles, "accepted old Genome"); newer = repo.commit({ ...genomeFiles, "P1/node.yaml": genomeFiles["P1/node.yaml"].replace("Help people", "Help more people") }, "accepted new Genome"); source = ns.create("demo-app").commit({ "index.ts": "export {}" }, "source");
  await inDo(i => i.bootstrap({ systemId: id, title: "Lineage", genomeRepo: "demo-system", appRepo: "demo-app", genomeCommit: newer, appCommit: source, artifactId: "artifact.webapp", templateVersions: {}, hookVersions: {}, platform: null, evolutions: [{ id:"evolution.1", title:"build",intent:"build",state:"actionable",kind:"implementation",affectedNodes:[],affectedClaims:[],genomeDelta:[],acceptanceCriteria:[],requiredEvidence:[],dependsOn:[],risk:"low" }] }));
});
afterEach(() => { setArtifactsOverride(undefined); setCiOverride(undefined); });
describe("deployment pinned Genome and binding lineage", () => {
  it("production realizes the binding Genome after accepted Genome advances", async () => {
    const state = await inDo(i => i.state()!);
    const existing = await inDo(i => i.systemCommit(state.head!)!);
    const commit: SystemCommit = { ...existing, composition: { ...state.manifest!, genomeCommit: newer, artifacts: { "artifact.webapp": { repo: "demo-app", commit: source, realizedGenome: older } } } };
    const deployment = await requestProductionDeploy(env, id, commit, "artifact.webapp");
    expect(deployment).not.toBeNull(); expect(params[0].genomeCommit).toBe(older);
    expect(params[0].artifactId).toBe("artifact.webapp"); expect(params[0].vars.ARTYFACT_ARTIFACT_ID).toBe("artifact.webapp");
    await inDo(i => { expect(i.build(params[0].buildId)!.genomeCommit).toBe(older); expect(i.state()!.genomeCommit).toBe(newer); });
  });
  it("preview outputs use stored Task pin instead of newer base-head Genome", async () => {
    const reserved = await inDo(i => {
      const r = i.reserveRealization({ evolutionId: "evolution.1", target: "app", agentLabel: "test" });
      const sql = (i as unknown as { sql: SqlStorage }).sql;
      sql.exec("UPDATE realizations SET pinned_genome=?,pinned_genome_repo=? WHERE id=?", older, "demo-system", r.realization.id);
      return i.realization(r.realization.id)!;
    });
    const state = await inDo(i => i.state()!);
    await dispatchPreviewBuild(env, state, reserved, { id: "candidate.pinned", commit: source });
    expect(params[0].genomeCommit).toBe(older);
  });
  it("refuses ambiguous production defaults and accepts explicit binding selection", async () => {
    await inDo(i => {
      const state=i.state()!,manifest={...state.manifest!,artifacts:{...state.manifest!.artifacts,"artifact.second":{repo:"other-owned-repo",commit:source,realizedGenome:older}}};
      (i as unknown as {sql:SqlStorage}).sql.exec("UPDATE system_commits SET manifest_json=? WHERE id=?",JSON.stringify(manifest),state.head);
    });
    await expect(createDeployment(env,id,{})).rejects.toThrow(/select an artifact binding/);
    await expect(createDeployment(env,id,{commit:source})).rejects.toThrow(/select an artifact binding/);
    const deployment=await createDeployment(env,id,{artifactId:"artifact.second",commit:source});
    expect(deployment.repo).toBe("other-owned-repo");
  });
  it("uses the authoritative output repository, not the current appSource repository", async () => {
    const output = await inDo(i => {
      const state=i.state()!, manifest={...state.manifest!,artifacts:{...state.manifest!.artifacts,"artifact.second":{repo:"other-owned-repo",commit:source,realizedGenome:older}}};
      (i as unknown as {sql:SqlStorage}).sql.exec("UPDATE system_commits SET manifest_json=? WHERE id=?",JSON.stringify(manifest),state.head);
      return i.upsertBuild({ id: "build.external", realization: null, candidate: null, commit: source, kind: "production", status: "passed", reporter: "admin", sourceRepo: "other-owned-repo", genomeCommit: older, thingId: "thing.webapp", artifactId: "artifact.second", output: { digest: "sha256:out" } }).build.output!; });
    const deployment = await createDeployment(env, id, { outputId: output.id, commit: source });
    expect(deployment.repo).toBe("other-owned-repo");
  });
});
