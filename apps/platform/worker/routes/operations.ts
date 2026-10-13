import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { PHENOME_LIMITS } from "@artyfact/model";
import type { FlagResponse, FlagsResponse, MeasurementsResponse, OperationAuditEntry, OperationsScope, RuntimeMetricsResponse } from "../../shared/operations";
import { requireAdmin } from "../auth";
import { badRequest, conflict, HttpError } from "../errors";
import { bindingScope, type OperationsEnv } from "../operations/config";
import { CloudflareOperationsProvider, ProviderUnavailable, type OperationsProvider } from "../operations/cloudflare";
import { aggregateMeasurements } from "../operations/measurements";
import { operationId, parseWindow, validateFlag } from "../operations/validation";
import { body, type AppEnv, type Ctx } from "./app";

interface AuditRpc {
  operationsAuditBegin(entry: OperationAuditEntry): Promise<boolean>;
  operationsAuditAppend(entry: OperationAuditEntry): Promise<void>;
  operationsAuditList(bindingId: string, limit?: number): Promise<OperationAuditEntry[]>;
}
const stamp = () => new Date().toISOString();
const errorReason = (e: unknown) => e instanceof ProviderUnavailable ? e.reason : "provider-unavailable";
const integer = (raw: string | undefined, name: string, max: number) => {
  if (raw === undefined) return undefined;
  const n = Number(raw); if (!Number.isInteger(n) || n < 1 || n > max) throw badRequest(`${name} must be an integer from 1 to ${max}`); return n;
};
export function createOperationsRoutes(options: { provider?: (env: OperationsEnv) => OperationsProvider } = {}) {
  const app = new Hono<AppEnv>();
  app.use("/systems/:id/operations/*", requireAdmin);
  app.use("/systems/:id/operations/*", bodyLimit({ maxSize: 300_000, onError: c => c.json({ error: { code: "body-too-large", message: "operations body exceeds 300KB" } }, 413) }));
  const resolve = async (c: Ctx) => {
    const systemId = c.req.param("id")!, bindingId = c.req.param("binding")!;
    const resolved = await bindingScope(c.env, systemId, bindingId);
    const scope: OperationsScope = { systemId, bindingId, environment: resolved.config?.environment ?? "unconfigured" };
    const provider = options.provider?.(c.env) ?? new CloudflareOperationsProvider((c.env as OperationsEnv).OPERATIONS_API_TOKEN ?? "");
    // Parent-owned DO wrapper; all DTOs are plain JSON.
    const audit = resolved.stub as typeof resolved.stub & AuditRpc;
    return { ...resolved, scope, provider, audit };
  };
  app.get("/systems/:id/operations/bindings", async c => {
    const resolved = await bindingScope(c.env, c.req.param("id"));
    return c.json({ bindings: Object.keys(resolved.artifacts).map(bindingId => ({ bindingId, configured: !!resolved.configs[bindingId], ...(resolved.configs[bindingId] && { environment: resolved.configs[bindingId]!.environment }) })) });
  });
  app.get("/systems/:id/operations/bindings/:binding/metrics", async c => {
    const { scope, config, provider } = await resolve(c);
    const now = Date.now();
    const window = parseWindow(c.req.query("from"), c.req.query("to"), now);
    const out: RuntimeMetricsResponse = { ...scope, window, retentionDays: config?.metricsRetentionDays ?? 1, provider: "cloudflare-workers-graphql", lineage: null, fetchedAt: stamp(), sampled: true, state: "unavailable", requests: null, invocationErrors: null, cpu: { unit: "microseconds", p50: null, p99: null } };
    if (!config) return c.json({ ...out, reason: "binding-unconfigured" });
    if (Date.parse(window.from) < now - config.metricsRetentionDays * 86_400_000 - 60_000) return c.json({ ...out, state: "retention-exceeded" as const, reason: "outside-configured-provider-retention" });
    try { const m = await provider.metrics(config, window); return c.json({ ...out, state: "available" as const, requests: m.requests, invocationErrors: m.invocationErrors, cpu: { unit: "microseconds" as const, p50: m.p50, p99: m.p99 } }); }
    catch (e) { return c.json({ ...out, reason: errorReason(e) }); }
  });
  app.get("/systems/:id/operations/bindings/:binding/measurements", async c => {
    const { scope, stub } = await resolve(c);
    const window = parseWindow(c.req.query("from"), c.req.query("to"));
    const before = integer(c.req.query("before"), "before", Number.MAX_SAFE_INTEGER);
    const page = await stub.phenomeEvents(scope.systemId, { kind: "measurement", limit: 200, ...(before !== undefined && { before }) });
    const measurements = aggregateMeasurements(page.events, scope.bindingId, window);
    const out: MeasurementsResponse = { ...scope, window, fetchedAt: stamp(), state: "partial", reason: page.nextBefore ? "more-retained-events" : "retained-events-only", measurements, retention: { rowCap: PHENOME_LIMITS.rowsPerSystem, kind: "system-row-cap" }, ...(page.nextBefore !== undefined && { nextBefore: page.nextBefore }) };
    return c.json(out);
  });
  app.get("/systems/:id/operations/bindings/:binding/audit", async c => {
    const { scope, audit } = await resolve(c);
    return c.json({ entries: await audit.operationsAuditList(scope.bindingId, integer(c.req.query("limit"), "limit", 200)) });
  });
  app.get("/systems/:id/operations/bindings/:binding/flags", async c => {
    const { scope, config, provider } = await resolve(c);
    const out: FlagsResponse = { ...scope, fetchedAt: stamp(), state: "unavailable", flags: [] };
    const cursor = c.req.query("cursor"); if (cursor && cursor.length > 2048) throw badRequest("cursor too long");
    if (!config?.flagshipAppId) return c.json({ ...out, reason: "flagship-unconfigured" });
    try { const page = await provider.listFlags(config, cursor); return c.json({ ...out, ...page, state: page.nextCursor ? "partial" as const : "available" as const }); }
    catch (e) { return c.json({ ...out, reason: errorReason(e) }); }
  });
  app.get("/systems/:id/operations/bindings/:binding/flags/:key", async c => {
    const { scope, config, provider } = await resolve(c), key = c.req.param("key");
    if (!operationId.safeParse(key).success || key.length > 64) throw badRequest("invalid flag key");
    const out: FlagResponse = { ...scope, fetchedAt: stamp(), state: "unavailable", flag: null };
    if (!config?.flagshipAppId) return c.json({ ...out, reason: "flagship-unconfigured" });
    try { return c.json({ ...out, state: "available" as const, flag: await provider.flag(config, key) }); }
    catch (e) { if (e instanceof HttpError) throw e; return c.json({ ...out, reason: errorReason(e) }); }
  });
  const mutate = async (c: Ctx, updating: boolean) => {
    const { scope, config, provider, audit } = await resolve(c);
    if (!config?.flagshipAppId) throw new HttpError(503, "flagship-unconfigured", "Flagship is not configured for this binding");
    const raw = await body(c), reason = raw.reason;
    if (typeof reason !== "string" || !reason.trim() || reason.length > 512) throw badRequest("a reason of 1–512 characters is required");
    const key = updating ? c.req.param("key") : (raw.flag as {key?: unknown} | undefined)?.key;
    if (typeof key !== "string" || !operationId.safeParse(key).success || key.length > 64) throw badRequest("invalid flag key");
    if (updating && (typeof raw.expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedVersion))) throw badRequest("expectedVersion is required");
    const entry: OperationAuditEntry = { ...scope, id: `audit.${crypto.randomUUID()}`, at: stamp(), actor: "admin", operation: updating ? "flag.update" : "flag.create", key, reason: reason.trim(), beforeVersion: null, afterVersion: null, status: "pending" };
    if (!(await audit.operationsAuditBegin(entry))) throw conflict("flag-operation-in-progress", "another operation on this flag is pending");
    let writeStarted = false;
    try {
      let definition;
      if (updating) {
        const current = await provider.flag(config, key);
        entry.beforeVersion = current.version;
        if (current.version !== raw.expectedVersion) { entry.status = "conflict"; throw conflict("flag-version-conflict", "the flag changed; reload before updating", { currentVersion: current.version }); }
        if (!raw.patch || typeof raw.patch !== "object" || Array.isArray(raw.patch)) throw badRequest("patch must be an object");
        const patch = raw.patch as Record<string, unknown>;
        if (Object.keys(patch).some(k => !["enabled", "default_variation", "variations", "rules", "description"].includes(k))) throw badRequest("unsupported flag patch field");
        const { version: _version, type: _type, updatedAt: _updated, ...base } = current;
        definition = validateFlag({ ...base, ...patch, key });
        if (current.enabled && definition.enabled === false) entry.operation = "flag.disable";
      } else definition = validateFlag(raw.flag);
      await audit.operationsAuditAppend(entry);
      writeStarted = true;
      const saved = updating ? await provider.updateFlag(config, definition) : await provider.createFlag(config, definition);
      entry.afterVersion = saved.version; entry.status = "applied";
      await audit.operationsAuditAppend(entry);
      return c.json<FlagResponse>({ ...scope, fetchedAt: stamp(), state: "available", flag: saved }, updating ? 200 : 201);
    } catch (e) {
      if (entry.status !== "applied") {
        // A transport failure after sending the write may have applied it. Record uncertainty, never claim rollback.
        if (entry.status !== "conflict") entry.status = writeStarted && !(e instanceof HttpError) ? "unknown" : "failed";
        await audit.operationsAuditAppend(entry);
      }
      if (e instanceof ProviderUnavailable) throw new HttpError(503, "flag-provider-unavailable", "Flagship unavailable; inspect the flag before retrying");
      throw e;
    }
  };
  app.post("/systems/:id/operations/bindings/:binding/flags", c => mutate(c, false));
  app.patch("/systems/:id/operations/bindings/:binding/flags/:key", c => mutate(c, true));
  return app;
}
export const operations = createOperationsRoutes();
