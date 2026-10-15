import { describe, expect, it, vi } from "vitest";
import { PlatformClient, PlatformError } from "../src/api.ts";
import { CliError } from "../src/git.ts";
import { sendJson, UnreachableError, type FetchLike } from "../src/transport.ts";

const SECRET = "s3cret-token-value";

function capture(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: FetchLike = async (url, init) => { calls.push({ url, init }); return response(); };
  return { calls, fetchImpl };
}

describe("sendJson", () => {
  it("builds the JSON/bearer request through the injected fetch", async () => {
    const { calls, fetchImpl } = capture(() => Response.json({ ok: true }));
    const res = await sendJson(fetchImpl, { method: "POST", base: "https://p.example/", path: "/api/x", body: { a: 1 }, token: SECRET, target: "platform" });
    expect(res).toMatchObject({ status: 200, ok: true, text: '{"ok":true}' });
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://p.example/api/x");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe('{"a":1}');
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("sends neither content-type nor authorization without a body or token", async () => {
    const { calls, fetchImpl } = capture(() => Response.json({}));
    await sendJson(fetchImpl, { method: "GET", base: "https://p.example", path: "/api/x", target: "platform" });
    expect(calls[0]!.init?.body).toBeUndefined();
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.has("content-type")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
  });

  it("decodes an empty 204 body as an empty object", async () => {
    const { fetchImpl } = capture(() => new Response(null, { status: 204 }));
    const res = await sendJson(fetchImpl, { method: "DELETE", base: "https://p.example", path: "/api/x", target: "platform" });
    expect(res).toMatchObject({ status: 204, ok: true, text: "" });
    expect(res.json()).toEqual({});
  });

  it("returns non-2xx bodies untouched for the caller's error policy", async () => {
    const { fetchImpl } = capture(() => new Response("<html>gateway</html>", { status: 502 }));
    const res = await sendJson(fetchImpl, { method: "GET", base: "https://p.example", path: "/api/x", target: "platform" });
    expect(res).toMatchObject({ status: 502, ok: false, text: "<html>gateway</html>" });
    expect(() => res.json()).toThrow(SyntaxError);
  });

  it("reports an unreachable target with the base and cause but never the credential", async () => {
    const fetchImpl: FetchLike = async () => { throw new TypeError("connection refused"); };
    const attempt = sendJson(fetchImpl, { method: "GET", base: "https://p.example", path: "/api/x", token: SECRET, target: "Parts catalog" });
    await expect(attempt).rejects.toBeInstanceOf(UnreachableError);
    await expect(attempt).rejects.toBeInstanceOf(CliError);
    const error = await attempt.catch((e: UnreachableError) => e) as UnreachableError;
    expect(error.message).toBe("cannot reach Parts catalog at https://p.example: connection refused");
    expect(error.message).not.toContain(SECRET);
    expect(error).toMatchObject({ base: "https://p.example", reason: "connection refused" });
  });

  it("falls back to the global fetch when none is injected", async () => {
    const spy = vi.fn(async () => Response.json({ global: true }));
    vi.stubGlobal("fetch", spy);
    try {
      const res = await sendJson(undefined, { method: "GET", base: "https://p.example", path: "/api/x", target: "platform" });
      expect(res.json()).toEqual({ global: true });
      expect(spy).toHaveBeenCalledWith("https://p.example/api/x", expect.objectContaining({ method: "GET" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("PlatformClient over the shared transport", () => {
  it("maps a structured JSON failure to PlatformError with status, code, details and detail", async () => {
    const { fetchImpl } = capture(() => Response.json({ error: { code: "not-found", message: "no such run", details: { id: "run.1" } } }, { status: 404 }));
    const client = new PlatformClient("https://p.example", SECRET, fetchImpl);
    const error = await client.request("GET", "/api/runs/run.1").catch((e: PlatformError) => e) as PlatformError;
    expect(error).toBeInstanceOf(PlatformError);
    expect(error).toMatchObject({ status: 404, code: "not-found", details: { id: "run.1" }, detail: "no such run" });
    expect(error.message).toBe("GET /api/runs/run.1 -> 404 not-found: no such run");
  });

  it("keeps a non-JSON failure body as the raw detail", async () => {
    const { fetchImpl } = capture(() => new Response("Bad Gateway", { status: 502 }));
    const client = new PlatformClient("https://p.example", undefined, fetchImpl);
    const error = await client.request("POST", "/api/x", { a: 1 }).catch((e: PlatformError) => e) as PlatformError;
    expect(error).toBeInstanceOf(PlatformError);
    expect(error).toMatchObject({ status: 502, code: undefined, details: undefined, detail: undefined });
    expect(error.message).toBe("POST /api/x -> 502 Bad Gateway");
  });

  it("trims the message when the failure body is empty", async () => {
    const { fetchImpl } = capture(() => new Response(null, { status: 500 }));
    const client = new PlatformClient("https://p.example", undefined, fetchImpl);
    const error = await client.request("GET", "/api/x").catch((e: PlatformError) => e) as PlatformError;
    expect(error.message).toBe("GET /api/x -> 500");
  });

  it("returns an empty object for an empty success body", async () => {
    const { fetchImpl } = capture(() => new Response(null, { status: 204 }));
    const client = new PlatformClient("https://p.example", SECRET, fetchImpl);
    expect(await client.request("DELETE", "/api/x")).toEqual({});
  });

  it("names the platform in network diagnostics without leaking the secret", async () => {
    const fetchImpl: FetchLike = async () => { throw new TypeError("getaddrinfo ENOTFOUND p.example"); };
    const client = new PlatformClient("https://p.example", SECRET, fetchImpl);
    const error = await client.request("GET", "/api/x").catch((e: Error) => e) as Error;
    expect(error).toBeInstanceOf(CliError);
    expect(error).not.toBeInstanceOf(PlatformError);
    expect(error.message).toBe("cannot reach platform at https://p.example: getaddrinfo ENOTFOUND p.example");
    expect(error.message).not.toContain(SECRET);
  });

  it("still refuses a secret over plain http to a remote host before any request", () => {
    expect(() => new PlatformClient("http://p.example", SECRET, async () => Response.json({}))).toThrow(/refusing to send the realization secret/);
  });
});
