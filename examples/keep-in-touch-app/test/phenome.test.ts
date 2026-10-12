import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Env } from "../src/worker/env";
import { emitPhenome, resetPhenomeThrottle } from "../src/worker/phenome";

const base = {
  BUILD_ID: "abc1234", ARTYFACT_PLATFORM_URL: "https://platform.example/", ARTYFACT_SYSTEM_ID: "sys-1",
  ARTYFACT_THING_ID: "thing.webapp", ARTYFACT_ARTIFACT_ID: "art.worker", ARTYFACT_DEPLOYMENT_ID: "dep-1", ARTYFACT_INGEST_TOKEN: "tok",
} as unknown as Env;

const stubFetch = () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetPhenomeThrottle(); });

describe("emitPhenome", () => {
  it("posts one event with the standard header and bearer token via waitUntil", async () => {
    const f = stubFetch();
    const pending: Promise<unknown>[] = [];
    emitPhenome(base, "health", { status: "ok" }, { waitUntil: (p) => void pending.push(p) }, { subject: "svc" });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://platform.example/api/systems/sys-1/phenome/events");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const { events } = JSON.parse(init!.body as string);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      systemId: "sys-1", thingId: "thing.webapp", artifactId: "art.worker", buildId: "abc1234", commit: "abc1234",
      deploymentId: "dep-1", kind: "health", subject: "svc", payload: { status: "ok" },
    });
    expect(Number.isNaN(Date.parse(events[0].emittedAt))).toBe(false);
    expect(typeof events[0].id).toBe("string");
  });

  it("is a silent no-op without the platform URL or system id", () => {
    const f = stubFetch();
    emitPhenome({ ...base, ARTYFACT_PLATFORM_URL: undefined } as Env, "health", {});
    emitPhenome({ ...base, ARTYFACT_SYSTEM_ID: "" } as Env, "health", {});
    expect(f).not.toHaveBeenCalled();
  });

  it("sends nothing for a non-commit BUILD_ID such as dev", () => {
    const f = stubFetch();
    emitPhenome({ ...base, BUILD_ID: "dev" } as Env, "health", {});
    expect(f).not.toHaveBeenCalled();
  });

  it("sets a request timeout", async () => {
    const f = stubFetch();
    emitPhenome(base, "x", 1);
    expect(f.mock.calls[0][1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("never throws or rejects when the platform is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const pending: Promise<unknown>[] = [];
    expect(() => emitPhenome(base, "health", {}, { waitUntil: (p) => void pending.push(p) })).not.toThrow();
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });

  it("omits optional header fields when unset", async () => {
    const f = stubFetch();
    const pending: Promise<unknown>[] = [];
    emitPhenome({ ...base, ARTYFACT_DEPLOYMENT_ID: undefined, ARTYFACT_INGEST_TOKEN: undefined } as Env, "x", 1, { waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    const init = f.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(init.body as string).events[0]).not.toHaveProperty("deploymentId");
  });
});

describe("app wiring", () => {
  it("/health emits a health event", async () => {
    const f = stubFetch();
    const waits: Promise<unknown>[] = [];
    const res = await app.fetch(new Request("http://x/health"), base, { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    await Promise.all(waits);
    expect(JSON.parse(f.mock.calls[0][1]!.body as string).events[0].kind).toBe("health");
  });

  it("contact save emits contact.saved without the name", async () => {
    const f = stubFetch();
    const waits: Promise<unknown>[] = [];
    const DB = (await import("cloudflare:workers")).env as unknown as { DB: D1Database };
    await DB.DB.exec("CREATE TABLE IF NOT EXISTS contact_records (id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, display_name TEXT NOT NULL, channels_json TEXT NOT NULL DEFAULT '[]', linked_account_id TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)");
    const res = await app.fetch(
      new Request("http://x/api/contacts", { method: "POST", headers: { "content-type": "application/json", "x-owner": "alice" }, body: JSON.stringify({ displayName: "Secret Name", channels: [{}] }) }),
      { ...base, DB: DB.DB, DEV_AUTH_HEADER: "1" } as Env,
      { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(201);
    await Promise.all(waits);
    const body = f.mock.calls[0][1]!.body as string;
    expect(JSON.parse(body).events[0].kind).toBe("contact.saved");
    expect(body).not.toContain("Secret Name");
  });

  it("throttles /health to one event per minute per isolate", async () => {
    const f = stubFetch();
    let now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const hit = async () => {
      const waits: Promise<unknown>[] = [];
      await app.fetch(new Request("http://x/health"), base, { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext);
      await Promise.all(waits);
    };
    await hit(); await hit();
    expect(f).toHaveBeenCalledTimes(1);
    now += 60_001;
    await hit();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("works without an execution context and without platform config", async () => {
    const f = stubFetch();
    const res = await app.fetch(new Request("http://x/health"), { BUILD_ID: "dev" } as Env);
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});
