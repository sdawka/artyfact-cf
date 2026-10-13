import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { resetPhenomeThrottle } from "../worker/phenome";
import { FakeArtifacts } from "./helpers/fake-artifacts";
import { appFiles, genomeFor } from "./fixtures/genome";
import type { PhenomeIngestResponse } from "../shared/api";
const headers = { authorization: "Bearer test-admin-token", "content-type": "application/json" };
afterEach(() => { setArtifactsOverride(undefined); resetPhenomeThrottle(); });
it("validates optional outcomes against the realized Genome's exact contract version", async () => {
  const systemId = "system.outcome-ingest";
  const files = genomeFor(systemId);
  files["node.yaml"] = files["node.yaml"]!.replace("kind: system", "kind: system\ntemplate: template.meta.outcomes@1");
  files["event.saved/node.yaml"] = "id: event.saved\nkind: eventContract\nfields:\n  name: Saved\n  version: 2\n  payloadFields: [{name: count, type: number, required: true}]\n";
  const artifacts = new FakeArtifacts();
  artifacts.create("outcome-genome").commit(files, "genome");
  const appCommit = artifacts.create("outcome-app").commit(appFiles, "app");
  setArtifactsOverride(artifacts);
  const imported = await exports.default.fetch(new Request("http://example.com/api/systems/import", { method: "POST", headers,
    body: JSON.stringify({ systemId, genomeRepo: "outcome-genome", appRepo: "outcome-app" }) }));
  expect(imported.status, await imported.clone().text()).toBe(201);
  const event = (version: number, count: unknown) => ({ systemId, thingId: "thing.webapp", artifactId: "artifact.webapp",
    buildId: appCommit, commit: appCommit, emittedAt: new Date().toISOString(), kind: "outcome.event", payload: { contractId: "event.saved", version, payload: { count } } });
  const response = await exports.default.fetch(new Request(`http://example.com/api/systems/${systemId}/phenome/events`, { method: "POST", headers,
    body: JSON.stringify({ events: [event(2, 3), event(1, 3), event(2, "3")] }) }));
  expect(response.status).toBe(200);
  const result = await response.json() as PhenomeIngestResponse;
  expect(result.accepted).toBe(1); expect(result.dropped).toHaveLength(2);
});
