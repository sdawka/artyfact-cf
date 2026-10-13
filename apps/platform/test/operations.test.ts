import { describe, expect, it } from "vitest";
import { validateFlag, validateMeasurement, parseWindow } from "../worker/operations/validation";

const flag = { key: "welcome", enabled: true, default_variation: "off", variations: { off: false, on: true }, rules: [{ priority: 1, conditions: [{ attribute: "plan", operator: "equals" as const, value: "pro" }], serve_variation: "on", rollout: { percentage: 25, attribute: "targetingKey" } }] };
describe("operations validation", () => {
  it("accepts targeting and percentage rollout with a valid disabled fallback", () => {
    expect(validateFlag(flag)).toEqual(flag);
    expect(() => validateFlag({ ...flag, default_variation: "missing" })).toThrow(/variation/);
    expect(() => validateFlag({ ...flag, rules: [{ ...flag.rules[0], rollout: { percentage: 101 } }] })).toThrow(/percentage/);
  });
  it("accepts finite numeric measurement payloads only", () => {
    expect(validateMeasurement({ name: "latency", value: 12, unit: "ms" })).toEqual({ name: "latency", value: 12, unit: "ms" });
    expect(() => validateMeasurement({ name: "latency", value: "12" })).toThrow();
    expect(() => validateMeasurement({ name: "latency", value: Infinity })).toThrow();
  });
  it("bounds windows and rejects future or reversed timestamps", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(parseWindow(undefined, undefined, now).to).toBe("2026-10-13T12:00:00.000Z");
    expect(() => parseWindow("2026-10-01T00:00:00Z", undefined, now)).toThrow(/7 days/);
    expect(() => parseWindow(undefined, "2026-10-14T00:00:00Z", now)).toThrow();
  });
});

import { CloudflareOperationsProvider, ProviderUnavailable } from "../worker/operations/cloudflare";
import { aggregateMeasurements } from "../worker/operations/measurements";
import { OperationsAuditStore } from "../worker/operations/audit-store";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";
import { createOperationsRoutes } from "../worker/routes/operations";
import { HttpError } from "../worker/errors";

const binding = { accountId: "a".repeat(32), scriptName: "demo-worker", environment: "production", flagshipAppId: "app-demo", metricsRetentionDays: 30 };
const window = { from: "2026-10-13T00:00:00.000Z", to: "2026-10-13T01:00:00.000Z" };
const result = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
describe("Cloudflare operations adapter", () => {
  it("scopes GraphQL variables to configured account and script, sums counts without averaging percentiles", async () => {
    let request: Request | undefined;
    const p = new CloudflareOperationsProvider("secret", async (input, init) => { request = new Request(input, init); return result({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 5, errors: 1 }, quantiles: { cpuTimeP50: 12, cpuTimeP99: 80 } }] }] } } }); });
    expect(await p.metrics(binding, window)).toEqual({ requests: 5, invocationErrors: 1, p50: 12, p99: 80 });
    expect((await request!.json() as { variables: unknown }).variables).toEqual({ accountTag: binding.accountId, scriptName: binding.scriptName, datetimeStart: window.from, datetimeEnd: window.to });
    expect(request!.headers.get("authorization")).toBe("Bearer secret");
  });
  it("rejects incomplete GraphQL responses rather than fabricating zero counts", async () => {
    const p = new CloudflareOperationsProvider("secret", async () => result({ errors: [{ message: "no access" }], data: {} }));
    await expect(p.metrics(binding, window)).rejects.toThrow(/unavailable/);
    const noData = new CloudflareOperationsProvider("secret", async () => result({ data: { viewer: { accounts: [] } } }));
    await expect(noData.metrics(binding, window)).rejects.toThrow();
  });
  it("uses management REST and full replacement, retaining disabled fallback", async () => {
    let request: Request | undefined;
    const p = new CloudflareOperationsProvider("secret", async (input, init) => { request = new Request(input, init); return result({ success: true, result: { ...flag, enabled: false, updated_at: "2026-10-13T00:00:00Z" } }); });
    const saved = await p.updateFlag(binding, { ...flag, enabled: false });
    expect(saved.default_variation).toBe("off"); expect(saved.version).toMatch(/^[a-f0-9]{64}$/);
    expect(request!.method).toBe("PUT"); expect(request!.url).toContain(`/accounts/${binding.accountId}/flagship/apps/app-demo/flags/welcome`);
    expect(await request!.json()).toEqual({ ...flag, enabled: false });
  });
});

describe("custom measurements", () => {
  it("filters binding/window and retains only stored lineage", () => {
    const e = { systemId: "system.demo", thingId: "thing.demo", artifactId: "artifact.web", kind: "measurement", payload: { name: "latency", value: 12 }, seq: 1, buildId: "build.1", commit: "b".repeat(40), emittedAt: window.from, receivedAt: window.to, outputId: "output.1", genomeCommit: "c".repeat(40) };
    const out = aggregateMeasurements([e, { ...e, artifactId: "artifact.other", seq: 2 }, { ...e, seq: 3, payload: { name: "bad", value: "12" } }], "artifact.web", window);
    expect(out).toHaveLength(1); expect(out[0].outputId).toBe("output.1"); expect(out[0].genomeCommit).toBe(e.genomeCommit);
    const noLineage = { ...e, outputId: undefined, genomeCommit: undefined };
    expect(aggregateMeasurements([noLineage], "artifact.web", window)[0]).not.toHaveProperty("outputId");
  });
});

describe("operations routes and durable audit", () => {
  it("authenticates scope reads and mutations, refuses unknown bindings before provider calls", async () => {
    const routes = createOperationsRoutes();
    routes.onError((e,c) => c.json({ error: e.message }, e instanceof HttpError ? e.status : 500));
    const path = "/systems/unknown/operations/bindings/artifact.web/flags";
    expect((await routes.request(path, {}, env)).status).toBe(401);
    expect((await routes.request(path, { method: "POST", body: "{}" }, env)).status).toBe(401);
    expect((await routes.request(path, { headers: { authorization: "Bearer test-admin-token" } }, env)).status).toBe(404);
  });
  it("persists pending and applied audit state durably without Genome changes", async () => {
    await runInDurableObject(env.SYSTEMS.getByName(`operations-audit-${crypto.randomUUID()}`), (i: SystemAuthority) => {
      const sql = (i as unknown as { sql: SqlStorage }).sql;
      const store = new OperationsAuditStore(sql);
      const entry = { id: "audit.1", systemId: "system.demo", bindingId: "artifact.web", environment: "production", at: window.to, actor: "admin" as const, operation: "flag.disable" as const, key: "welcome", reason: "stop", beforeVersion: "v1", afterVersion: null, status: "pending" as const };
      store.append(entry); store.append({ ...entry, status: "applied", afterVersion: "v2" });
      expect(new OperationsAuditStore(sql).list("artifact.web", 10)).toEqual([{ ...entry, status: "applied", afterVersion: "v2" }]);
      expect(store.list("artifact.other", 10)).toEqual([]);
    });
  });
});

describe("existing grouped Flagship rules", () => {
  it("keeps grouped targeting and documented comparison operators readable", () => {
    const grouped = { ...flag, rules: [{ priority: 1, conditions: { logical_operator: "AND", clauses: [{ attribute: "age", operator: "greater_than_or_equals", value: 18 }] }, serve_variation: "on" }] };
    expect(validateFlag(grouped)).toEqual(grouped);
  });
});

import type { OperationsProvider } from "../worker/operations/cloudflare";
import type { OperationalFlag } from "../shared/operations";
import { beforeEach } from "vitest";
let routeSystem: string, scopedEnv: Env, currentFlag: OperationalFlag, writes: number, failProvider: boolean;
const G = "1".repeat(40), A = "a".repeat(40);
const scopedRoutes = () => {
  const provider: OperationsProvider = {
    metrics: async () => { if (failProvider) throw new Error("secret-provider-details"); return { requests: 4, invocationErrors: 1, p50: 2, p99: 8 }; },
    listFlags: async () => ({ flags: [currentFlag] }), flag: async () => currentFlag,
    createFlag: async (_b, f) => { writes++; if (failProvider) throw new ProviderUnavailable(); return { ...f, version: "b".repeat(64) }; },
    updateFlag: async (_b, f) => { writes++; if (failProvider) throw new ProviderUnavailable(); return { ...f, version: "b".repeat(64) }; },
  };
  const app = createOperationsRoutes({ provider: () => provider });
  app.onError((e,c) => c.json({ error: { code: e instanceof HttpError ? e.code : "unknown", message: e.message } }, e instanceof HttpError ? e.status : 500));
  return app;
};
beforeEach(async () => {
  routeSystem = `operations-${crypto.randomUUID()}`; currentFlag = { ...flag, version: "a".repeat(64) }; writes = 0; failProvider = false;
  await runInDurableObject(env.SYSTEMS.getByName(routeSystem), async (i: SystemAuthority) => {
    await i.bootstrap({ systemId: routeSystem, title: "Operations", genomeRepo: "demo-system", appRepo: "demo-app", genomeCommit: G, appCommit: A, artifactId: "artifact.web", templateVersions: {}, hookVersions: {}, platform: null, evolutions: [] });
    return i.summary()!;
  }).then(summary => env.SYSTEMS.getByName(REGISTRY).registerSystem({ ...summary, systemId: routeSystem }));
  scopedEnv = { ...env, OPERATIONS_BINDINGS: JSON.stringify({ [routeSystem]: { "artifact.web": binding } }) } as Env;
});
const opPath = (leaf: string, artifact = "artifact.web") => `/systems/${routeSystem}/operations/bindings/${artifact}/${leaf}`;
const authorized = { authorization: "Bearer test-admin-token", "content-type": "application/json" };
describe("configured operations behavior", () => {
  it("returns unavailable failures with null metrics and never manufactures current output lineage", async () => {
    const app = scopedRoutes();
    const good = await (await app.request(opPath("metrics"), { headers: authorized }, scopedEnv)).json() as { lineage: unknown; requests: number };
    expect(good.requests).toBe(4); expect(good.lineage).toBeNull();
    failProvider = true;
    const failed = await (await app.request(opPath("metrics"), { headers: authorized }, scopedEnv)).json() as { state: string; requests: unknown; reason: string };
    expect(failed.state).toBe("unavailable"); expect(failed.requests).toBeNull(); expect(failed.reason).toBe("provider-unavailable");
    expect((await app.request(opPath("metrics", "artifact.other"), { headers: authorized }, scopedEnv)).status).toBe(404);
  });
  it("accepts a last-24-hours client window at default one-day retention", async () => {
    const e = { ...env, OPERATIONS_BINDINGS: JSON.stringify({ [routeSystem]: { "artifact.web": { ...binding, metricsRetentionDays: 1 } } }) } as Env;
    const to=new Date(Date.now()-100).toISOString(),from=new Date(Date.parse(to)-86_400_000).toISOString();
    const out=await (await scopedRoutes().request(`${opPath("metrics")}?from=${from}&to=${to}`,{headers:authorized},e)).json() as {state:string};
    expect(out.state).toBe("available");
  });
  it("reports retention-exceeded windows without calling the provider", async () => {
    const e = { ...env, OPERATIONS_BINDINGS: JSON.stringify({ [routeSystem]: { "artifact.web": { ...binding, metricsRetentionDays: 1 } } }) } as Env;
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString(), to = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const out = await (await scopedRoutes().request(`${opPath("metrics")}?from=${from}&to=${to}`, { headers: authorized }, e)).json() as { state: string; requests: unknown };
    expect(out.state).toBe("retention-exceeded"); expect(out.requests).toBeNull();
  });
  it("rejects stale updates and persists conflicts without performing a write", async () => {
    const app = scopedRoutes();
    const res = await app.request(opPath("flags/welcome"), { method: "PATCH", headers: authorized, body: JSON.stringify({ expectedVersion: "f".repeat(64), patch: { enabled: false }, reason: "stop" }) }, scopedEnv);
    expect(res.status).toBe(409); expect(writes).toBe(0);
    const audit = await (await app.request(opPath("audit"), { headers: authorized }, scopedEnv)).json() as { entries: { status: string }[] };
    expect(audit.entries[0].status).toBe("conflict");
  });
  it("disables operationally with audit while preserving Genome revision", async () => {
    const app = scopedRoutes();
    const res = await app.request(opPath("flags/welcome"), { method: "PATCH", headers: authorized, body: JSON.stringify({ expectedVersion: currentFlag.version, patch: { enabled: false }, reason: "stop rollout" }) }, scopedEnv);
    expect(res.status).toBe(200); expect(writes).toBe(1);
    const out = await res.json() as { flag: OperationalFlag }; expect(out.flag.enabled).toBe(false); expect(out.flag.default_variation).toBe("off");
    const audit = await (await app.request(opPath("audit"), { headers: authorized }, scopedEnv)).json() as { entries: { operation: string; status: string }[] };
    expect(audit.entries[0]).toMatchObject({ operation: "flag.disable", status: "applied" });
    await runInDurableObject(env.SYSTEMS.getByName(routeSystem), (i: SystemAuthority) => { expect(i.state()!.genomeCommit).toBe(G); });
  });
  it("marks unknown outcome when an external mutation loses its response", async () => {
    failProvider = true; const app = scopedRoutes();
    const res = await app.request(opPath("flags"), { method: "POST", headers: authorized, body: JSON.stringify({ flag, reason: "create" }) }, scopedEnv);
    expect(res.status).toBe(503); expect(writes).toBe(1);
    const audit = await (await app.request(opPath("audit"), { headers: authorized }, scopedEnv)).json() as { entries: { status: string }[] };
    expect(audit.entries[0].status).toBe("unknown");
  });
  it("bounds mutation bodies before provider writes", async () => {
    const res = await scopedRoutes().request(opPath("flags"), { method:"POST", headers:authorized, body:JSON.stringify({flag,reason:"x".repeat(310_000)}) },scopedEnv);
    expect(res.status).toBe(413); expect(writes).toBe(0);
  });
  it("excludes concurrent platform changes to the same flag and records expired uncertain operations", async () => {
    await runInDurableObject(env.SYSTEMS.getByName(routeSystem), (i: SystemAuthority) => {
      const store = new OperationsAuditStore((i as unknown as { sql: SqlStorage }).sql);
      const entry = { id: "audit.pending", systemId: routeSystem, bindingId: "artifact.web", environment: "production", at: new Date().toISOString(), actor: "admin" as const, operation: "flag.update" as const, key: "welcome", reason: "pending", beforeVersion: null, afterVersion: null, status: "pending" as const };
      expect(store.begin(entry)).toBe(true); expect(store.begin({ ...entry, id: "audit.second" })).toBe(false);
      expect(store.begin({ ...entry, id: "audit.third", at: new Date(Date.parse(entry.at) + 61_000).toISOString() })).toBe(true);
      expect(store.list("artifact.web").find(e => e.id === entry.id)?.status).toBe("unknown");
    });
  });
});
