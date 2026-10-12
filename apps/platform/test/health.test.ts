import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("reports ok", async () => {
    const res = await exports.default.fetch(new Request("http://example.com/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string; time: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("artyfact-platform");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
