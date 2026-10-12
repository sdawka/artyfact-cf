import { describe, expect, it } from "vitest";
import { DEFAULT_URL, resolvePlatform } from "../src/platform-url.ts";

/** A fake localhost: `ports` maps a port to what answers there; anything else refuses the connection. */
function localhost(ports: Record<number, () => Response>) {
  const asked: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(url.port);
    const answer = ports[Number(url.port)];
    if (!answer) throw new TypeError("fetch failed: ECONNREFUSED");
    return answer();
  }) as typeof fetch;
  return { f, asked };
}
const artyfact = () => Response.json({ status: "ok", service: "artyfact-platform" });

describe("resolvePlatform", () => {
  it("uses --platform, then ARTYFACT_PLATFORM, then ARTYFACT_URL, without probing", async () => {
    const { f, asked } = localhost({});
    expect(await resolvePlatform("https://p.example/", { ARTYFACT_PLATFORM: "http://x" }, f)).toBe("https://p.example");
    expect(await resolvePlatform(undefined, { ARTYFACT_PLATFORM: "http://x", ARTYFACT_URL: "http://y" }, f)).toBe("http://x");
    expect(await resolvePlatform(undefined, { ARTYFACT_URL: "http://y/" }, f)).toBe("http://y");
    expect(asked).toEqual([]);
  });

  it("defaults to localhost:1337 when the platform answers there", async () => {
    const { f, asked } = localhost({ 1337: artyfact });
    const notes: string[] = [];
    expect(await resolvePlatform(undefined, {}, f, (s) => notes.push(s))).toBe("http://localhost:1337");
    expect(asked).toEqual(["1337"]);
    expect(notes).toEqual([]);
  });

  it("follows Vite to the next port when 1337 is taken by something else", async () => {
    const { f } = localhost({ 1337: () => new Response("<html>", { status: 200 }), 1338: () => new Response("nope", { status: 404 }), 1339: artyfact });
    const notes: string[] = [];
    expect(await resolvePlatform(undefined, {}, f, (s) => notes.push(s))).toBe("http://localhost:1339");
    expect(notes).toEqual(["platform found at http://localhost:1339 (port 1337 is taken by something else)"]);
  });

  it("falls back to the configured default when nothing answers as artyfact", async () => {
    const { f, asked } = localhost({ 1340: () => Response.json({ service: "other" }) });
    expect(await resolvePlatform(undefined, {}, f)).toBe(DEFAULT_URL);
    expect(asked).toHaveLength(10);
  });
});

describe("assertBearerTransport", () => {
  it("allows https and plain http to localhost or 127.0.0.1 only", async () => {
    const { assertBearerTransport } = await import("../src/platform-url.ts");
    for (const ok of ["https://p.example", "http://localhost:1337", "http://127.0.0.1:8787"]) expect(() => assertBearerTransport(ok, "x")).not.toThrow();
    for (const bad of ["http://p.example", "http://localhost.evil.com", "http://10.0.0.1", "ftp://localhost", "nope"]) expect(() => assertBearerTransport(bad, "x"), bad).toThrow();
  });

  it("PlatformClient refuses to carry a realization secret over plain http to a remote host", async () => {
    const { PlatformClient } = await import("../src/api.ts");
    expect(() => new PlatformClient("http://p.example", "s3cret")).toThrow(/refusing to send the realization secret/);
    expect(() => new PlatformClient("http://p.example")).not.toThrow();
  });
});
