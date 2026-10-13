import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  it("reports ok with the build id", async () => {
    const res = await (exports as unknown as { default: { fetch(r: Request): Promise<Response> } }).default.fetch(new Request("http://example.com/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", buildId: "test" });
  });
});
