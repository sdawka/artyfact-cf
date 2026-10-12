import { describe, expect, it } from "vitest";
import { httpHealth } from "../../worker/hooks/http-health";

const commit = "0123456789abcdef0123456789abcdef01234567";
const fakeFetch = (status: number, body: unknown, seen: string[] = []) =>
  (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;

describe("http engine", () => {
  it("passes on 200, status ok and a matching buildId prefix", async () => {
    const seen: string[] = [];
    const o = await httpHealth({ previewUrl: "https://p.example/", commit, fetch: fakeFetch(200, { status: "ok", buildId: commit.slice(0, 7) }, seen) });
    expect(o).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(seen).toEqual(["https://p.example/health"]);
  });

  it("fails on a wrong buildId", async () => {
    const o = await httpHealth({ previewUrl: "https://p.example", commit, fetch: fakeFetch(200, { status: "ok", buildId: "deadbeef" }) });
    expect(o).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(o.observations).toContainEqual(expect.objectContaining({ buildId: "deadbeef" }));
  });

  it("fails on non-200 and on status other than ok", async () => {
    expect((await httpHealth({ previewUrl: "https://p", commit, fetch: fakeFetch(500, { status: "ok", buildId: commit }) })).verdict).toBe("fail");
    expect((await httpHealth({ previewUrl: "https://p", commit, fetch: fakeFetch(200, { status: "degraded", buildId: commit }) })).verdict).toBe("fail");
  });

  it("fails on a non-JSON body", async () => {
    expect((await httpHealth({ previewUrl: "https://p", commit, fetch: fakeFetch(200, "<html>") })).verdict).toBe("fail");
  });

  it("is not-run/unknown without a preview URL", async () => {
    const o = await httpHealth({ commit, fetch: fakeFetch(200, {}) });
    expect(o).toMatchObject({ execution: "not-run", verdict: "unknown" });
  });

  it("records an error, never a verdict, when the request throws or times out", async () => {
    const boom = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    const o = await httpHealth({ previewUrl: "https://p", commit, fetch: boom });
    expect(o).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(o.observations)).toContain("network down");

    const hang = ((_: unknown, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const t = await httpHealth({ previewUrl: "https://p", commit, fetch: hang, timeoutMs: 20 });
    expect(t).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(t.observations)).toContain("timed out");
  });
});
