import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { expect, it } from "vitest";
import type { IntegrityRunResponse, IntegritySnapshotResponse } from "../shared/integrity";
import { genomeFor } from "./fixtures/genome";

const ADMIN = { authorization: "Bearer test-admin-token", "content-type": "application/json" };
async function call(method: string, path: string, body?: unknown, admin = true) {
  return exports.default.fetch(new Request(`http://example.com/api${path}`, {
    method,
    headers: admin ? ADMIN : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

function initialFiles(systemId: string, directive = ""): Record<string, string> {
  return {
    ...genomeFor(systemId),
    "intent/brief.md": `# Intent\n\nCreate an inspectable source-free System. ${directive}\n`,
    "intent/manifest.json": JSON.stringify({ version: 1, nodes: [{ nodeId: systemId, briefSections: ["Intent"], documents: [] }] }),
  };
}

it("creates an admin-only immutable initial preview without an app binding", async () => {
  const systemId = `system.integrity${crypto.randomUUID().replaceAll("-", "")}`;
  expect((await call("POST", `/systems/${systemId}/integrity/preview`, { files: initialFiles(systemId) }, false)).status).toBe(401);
  expect((await call("POST", "/systems/initial", { systemId })).status).toBe(201);

  const first = await call("POST", `/systems/${systemId}/integrity/preview`, { files: initialFiles(systemId) });
  expect(first.status, await first.clone().text()).toBe(201);
  const a = await first.json() as IntegritySnapshotResponse;
  expect(a.snapshot.systemId).toBe(systemId);
  expect(a.snapshot.files["intent/brief.md"]).toContain("source-free");

  const second = await call("POST", `/systems/${systemId}/integrity/preview`, { files: initialFiles(systemId) });
  const b = await second.json() as IntegritySnapshotResponse;
  expect(b.snapshot.id).toBe(a.snapshot.id);
  expect(b.snapshot.hash).toBe(a.snapshot.hash);
});

it("keeps snapshots and runs inside their System authority", async () => {
  const firstId = `system.integritya${crypto.randomUUID().replaceAll("-", "")}`;
  const secondId = `system.integrityb${crypto.randomUUID().replaceAll("-", "")}`;
  await call("POST", "/systems/initial", { systemId: firstId });
  await call("POST", "/systems/initial", { systemId: secondId });
  const preview = await (await call("POST", `/systems/${firstId}/integrity/preview`, { files: initialFiles(firstId) })).json() as IntegritySnapshotResponse;
  const started = await (await call("POST", `/systems/${firstId}/integrity/runs`, { snapshotId: preview.snapshot.id, provider: "off" })).json() as IntegrityRunResponse;
  await call("POST", `/systems/${firstId}/integrity/runs/${started.run.id}/cancel`);
  const foreign = await call("GET", `/systems/${secondId}/integrity/runs/${started.run.id}`);
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toMatchObject({ error: { code: "not-found" } });
});

it("reuses an identical active run and reports an off provider as needs-review", async () => {
  const systemId = `system.integrity${crypto.randomUUID().replaceAll("-", "")}`;
  await call("POST", "/systems/initial", { systemId });
  const preview = await (await call("POST", `/systems/${systemId}/integrity/preview`, { files: initialFiles(systemId) })).json() as IntegritySnapshotResponse;
  const request = { snapshotId: preview.snapshot.id, provider: "off" };
  const a = await (await call("POST", `/systems/${systemId}/integrity/runs`, request)).json() as IntegrityRunResponse;
  const b = await (await call("POST", `/systems/${systemId}/integrity/runs`, request)).json() as IntegrityRunResponse;
  expect(b.run.id).toBe(a.run.id);

  await runDurableObjectAlarm(env.SYSTEMS.getByName(systemId));
  const completed = await (await call("GET", `/systems/${systemId}/integrity/runs/${a.run.id}`)).json() as IntegrityRunResponse;
  expect(completed.run.state).toBe("completed");
  expect(completed.run.report?.status).toBe("blocked");
  expect(completed.run.report?.semantic.status).toBe("needs-review");
  expect(completed.run.report?.semantic.provenance?.provider).toBe("off");
  expect(completed.run.report?.semantic.complete).toBe(false);
});

it("cancels queued work before the alarm can make provider calls", async () => {
  const systemId = `system.integrity${crypto.randomUUID().replaceAll("-", "")}`;
  await call("POST", "/systems/initial", { systemId });
  const preview = await (await call("POST", `/systems/${systemId}/integrity/preview`, { files: initialFiles(systemId) })).json() as IntegritySnapshotResponse;
  const started = await (await call("POST", `/systems/${systemId}/integrity/runs`, { snapshotId: preview.snapshot.id, provider: "off" })).json() as IntegrityRunResponse;
  const cancelled = await (await call("POST", `/systems/${systemId}/integrity/runs/${started.run.id}/cancel`)).json() as IntegrityRunResponse;
  expect(cancelled.run.state).toBe("cancelled");
  expect(cancelled.run.error).toMatchObject({ code: "cancelled", message: "Cancelled after 0 checkpointed provider batches." });
  await runDurableObjectAlarm(env.SYSTEMS.getByName(systemId));
  const after = await (await call("GET", `/systems/${systemId}/integrity/runs/${started.run.id}`)).json() as IntegrityRunResponse;
  expect(after.run.state).toBe("cancelled");
  expect(after.run.report).toBeUndefined();
});
