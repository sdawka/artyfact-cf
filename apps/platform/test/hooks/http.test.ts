import { beforeEach, describe, expect, it } from "vitest";
import { httpHealth, previewPolicy, validatePreviewUrl } from "../../worker/hooks/http-health";

const commit = "0123456789abcdef0123456789abcdef01234567";
const PREVIEW = "https://peopling-app-r1.acct.workers.dev";
const fakeFetch = (status: number, body: unknown, seen: { url: string; init?: RequestInit }[] = [], headers: Record<string, string> = {}) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as typeof fetch;

describe("http engine: verdicts", () => {
  it("passes on 200, status ok and a matching buildId prefix; no redirects followed", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const o = await httpHealth({ previewUrl: `${PREVIEW}/`, commit, fetch: fakeFetch(200, { status: "ok", buildId: commit.slice(0, 7) }, seen) });
    expect(o).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(seen[0].url).toBe(`${PREVIEW}/health`);
    expect(seen[0].init?.redirect).toBe("manual");
    expect(o.observations).toEqual([{ url: `${PREVIEW}/health`, status: 200, ok: true, buildId: commit.slice(0, 7), attempts: 1 }]);
  });

  it("requires the exact authoritative build id when supplied, even for the same source", async () => {
    const expectedBuildId = "build.preview.123";
    expect((await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, fetch: fakeFetch(200, { status: "ok", buildId: expectedBuildId }) })).verdict).toBe("pass");
    for (const buildId of ["build.preview.124", commit, "build.preview.123-extra", "BUILD.PREVIEW.123"]) {
      expect((await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, retryDelaysMs: [], fetch: fakeFetch(200, { status: "ok", buildId }) })).verdict).toBe("fail");
    }
  });

  it("fails on a wrong buildId, recording only status/ok/buildId", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, retryDelaysMs: [], fetch: fakeFetch(200, { status: "ok", buildId: "deadbeef", secret: "x" }) });
    expect(o).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(o.observations).toEqual([{ url: `${PREVIEW}/health`, status: 200, ok: true, buildId: "deadbeef", error: "buildId does not match the commit", attempts: 1 }]);
  });

  it("fails on non-200 and on status other than ok", async () => {
    expect((await httpHealth({ previewUrl: PREVIEW, commit, fetch: fakeFetch(500, { status: "ok", buildId: commit }) })).verdict).toBe("fail");
    expect((await httpHealth({ previewUrl: PREVIEW, commit, fetch: fakeFetch(200, { status: "degraded", buildId: commit }) })).verdict).toBe("fail");
  });

  it("is unknown on a 3xx, not followed, recording only url and status", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, fetch: fakeFetch(302, "redirect body", [], { location: "http://169.254.169.254/" }) });
    expect(o).toMatchObject({ execution: "completed", verdict: "unknown", interpretation: "redirect (HTTP 302) not followed" });
    expect(o.observations).toEqual([{ url: `${PREVIEW}/health`, status: 302, attempts: 1 }]);
  });

  it("states what a pass proves", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, fetch: fakeFetch(200, { status: "ok", buildId: commit }) });
    expect(o.limitations).toContain("A pass proves only that the allowlisted host served a matching buildId, not who operates that host.");
  });

  it("fails on a non-JSON body without echoing it", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, fetch: fakeFetch(200, "<html>internal secret page</html>") });
    expect(o.verdict).toBe("fail");
    expect(JSON.stringify(o)).not.toContain("internal secret");
  });

  it("fails on an oversized body", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, fetch: fakeFetch(200, "x".repeat(20_000)) });
    expect(o.verdict).toBe("fail");
    expect(o.interpretation).toMatch(/body larger than/);
  });

  it("clips a long buildId to 64 chars", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, retryDelaysMs: [], fetch: fakeFetch(200, { status: "ok", buildId: "a".repeat(500) }) });
    expect(((o.observations[0] as { buildId: string }).buildId).length).toBeLessThanOrEqual(64);
  });

  it("is not-run/unknown without a preview URL", async () => {
    expect(await httpHealth({ commit, fetch: fakeFetch(200, {}) })).toMatchObject({ execution: "not-run", verdict: "unknown" });
  });

  it("never matches when the commit is shorter than 7 chars", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit: "", retryDelaysMs: [], fetch: fakeFetch(200, { status: "ok", buildId: "anything-long" }) });
    expect(o.verdict).toBe("fail");
  });

  it("records an error with a clipped message, never a verdict, when the request throws or times out", async () => {
    const boom = (async () => { throw new TypeError(`network down ${"z".repeat(200)}`); }) as unknown as typeof fetch;
    const o = await httpHealth({ previewUrl: PREVIEW, commit, fetch: boom });
    expect(o).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(o.interpretation!.length).toBeLessThanOrEqual(64);

    const hang = ((_: unknown, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const t = await httpHealth({ previewUrl: PREVIEW, commit, fetch: hang, timeoutMs: 20 });
    expect(t).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(t.observations)).toContain("timed out");
  });
});

describe("http engine: buildId mismatch retries", () => {
  const expectedBuildId = "build.realization.8.r6.69a82a8.ci";
  const PREVIOUS = "build.realization.8.r6.3931a97.ci";
  /** Serves `ids` in order (the last one repeats), recording each request. */
  const serving = (ids: string[], seen: string[] = [], status = 200, health = "ok") =>
    (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return Response.json({ status: health, buildId: ids[Math.min(seen.length - 1, ids.length - 1)] }, { status });
    }) as typeof fetch;
  const waits: number[] = [];
  const sleep = async (ms: number) => { waits.push(ms); };
  beforeEach(() => { waits.length = 0; });

  it("passes once the preview switches to the expected build, recording the attempts", async () => {
    const seen: string[] = [];
    const o = await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, fetch: serving([PREVIOUS, expectedBuildId], seen) });
    expect(o).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(o.observations).toEqual([{ url: `${PREVIEW}/health`, status: 200, ok: true, buildId: expectedBuildId, attempts: 2 }]);
    expect(seen).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it("fails with the same message after every retry still serves another build", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, fetch: serving([PREVIOUS]) });
    expect(o).toMatchObject({ execution: "completed", verdict: "fail", interpretation: "buildId does not match the expected build" });
    expect(o.observations).toEqual([{ url: `${PREVIEW}/health`, status: 200, ok: true, buildId: PREVIOUS, error: "buildId does not match the expected build", attempts: 4 }]);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it("honours custom delays and drops retries that would exceed the budget", async () => {
    const custom = await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, retryDelaysMs: [5, 5], fetch: serving([PREVIOUS]) });
    expect((custom.observations[0] as { attempts: number }).attempts).toBe(3);
    waits.length = 0;
    // 2 s per attempt: 2 + 1 + 2 = 5 s fits a 6 s budget, a further 2 + 2 s does not.
    const tight = await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, budgetMs: 6000, fetch: serving([PREVIOUS]) });
    expect((tight.observations[0] as { attempts: number }).attempts).toBe(2);
    expect(waits).toEqual([1000]);
  });

  it("does not retry an unhealthy response or a transport error", async () => {
    const seen: string[] = [];
    expect((await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, fetch: serving([PREVIOUS], seen, 500) })).verdict).toBe("fail");
    expect((await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, fetch: serving([PREVIOUS], seen, 200, "degraded") })).verdict).toBe("fail");
    expect(seen).toHaveLength(2);
    const boom = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    expect(await httpHealth({ previewUrl: PREVIEW, commit, expectedBuildId, sleep, fetch: boom })).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(waits).toEqual([]);
  });
});

describe("http engine: previewUrl validation (SSRF)", () => {
  const never = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
  const rejects = async (previewUrl: string, reason: RegExp, env = {}) => {
    const o = await httpHealth({ previewUrl, commit, fetch: never, policy: previewPolicy(env) });
    expect(o).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(o.observations[0]).toMatch(/^previewUrl rejected: /);
    expect(String(o.observations[0])).toMatch(reason);
  };

  it("rejects an invalid URL", () => rejects("not a url", /not a valid URL/));
  it("rejects http on an allowed host", () => rejects("http://peopling.acct.workers.dev", /use https/));
  it("rejects other schemes", () => rejects("file:///etc/passwd", /scheme file/));
  it("rejects hosts off the allowlist", () => rejects("https://evil.example.com", /not on the preview allowlist/));
  it("rejects the bare apex of a wildcard entry and look-alike suffixes", async () => {
    await rejects("https://workers.dev", /allowlist/);
    await rejects("https://kitworkers.dev", /allowlist/);
    await rejects("https://workers.dev.evil.com", /allowlist/);
    await rejects("https://evil-workers.dev", /allowlist/);
  });

  it("rejects an allowed host used as userinfo before another host", () => rejects("https://a.workers.dev@evil.com", /credentials/));
  it("rejects IP literals, v4 and v6, including private, loopback and link-local", async () => {
    await rejects("https://10.0.0.1/", /IP address/);
    await rejects("https://169.254.169.254/", /IP address/);
    await rejects("https://[::1]/", /IP address/);
    await rejects("https://2130706433/", /IP address/);
  });
  it("rejects localhost without ALLOW_LOCAL_PREVIEW", async () => {
    await rejects("http://localhost:8787", /use https/);
    await rejects("https://localhost:8787", /local hosts/);
    await rejects("https://127.0.0.1", /IP address/);
  });
  it("rejects credentials and non-default ports", async () => {
    await rejects("https://user:pw@peopling.acct.workers.dev", /credentials/);
    await rejects("https://peopling.acct.workers.dev:8443", /port 8443/);
  });

  it("accepts *.workers.dev, *.pages.dev, a trailing dot and upper case", () => {
    const p = previewPolicy();
    expect(validatePreviewUrl("https://peopling.acct.workers.dev", p).ok).toBe(true);
    expect(validatePreviewUrl("https://abc.peopling.pages.dev/", p).ok).toBe(true);
    expect(validatePreviewUrl("https://PEOPLING.acct.Workers.Dev./", p).ok).toBe(true);
  });

  it("ignores empty and malformed allowlist entries", () => {
    const p = previewPolicy({ PREVIEW_HOST_ALLOWLIST: "a.com,,  ,*,*.,*.com,https://b.com,c.com:8443,d.example.org" });
    expect(p.hosts).toEqual(["*.workers.dev", "*.pages.dev", "a.com", "d.example.org"]);
    expect(validatePreviewUrl("https://x.workers.dev..", p).ok).toBe(false);
  });

  it("accepts PREVIEW_HOST_ALLOWLIST entries (exact and wildcard)", () => {
    const p = previewPolicy({ PREVIEW_HOST_ALLOWLIST: " preview.example.com , *.staging.example.org " });
    expect(validatePreviewUrl("https://preview.example.com", p).ok).toBe(true);
    expect(validatePreviewUrl("https://a.staging.example.org", p).ok).toBe(true);
    expect(validatePreviewUrl("https://other.example.com", p).ok).toBe(false);
  });

  it("allows http(s)://localhost and 127.0.0.1 only with ALLOW_LOCAL_PREVIEW=1", async () => {
    const p = previewPolicy({ ALLOW_LOCAL_PREVIEW: "1" });
    expect(validatePreviewUrl("http://localhost:8787", p).ok).toBe(true);
    expect(validatePreviewUrl("http://127.0.0.1:8787", p).ok).toBe(true);
    expect(validatePreviewUrl("http://10.0.0.1", p).ok).toBe(false);
    const seen: { url: string }[] = [];
    const o = await httpHealth({ previewUrl: "http://localhost:8787", commit, policy: p, fetch: fakeFetch(200, { status: "ok", buildId: commit }, seen) });
    expect(o.verdict).toBe("pass");
    expect(seen[0].url).toBe("http://localhost:8787/health");
  });

  it("does not follow a redirect from a local preview host", async () => {
    const p = previewPolicy({ ALLOW_LOCAL_PREVIEW: "1" });
    const o = await httpHealth({ previewUrl: "http://localhost:8787", commit, policy: p, fetch: fakeFetch(301, "", [], { location: "http://10.0.0.1/" }) });
    expect(o).toMatchObject({ execution: "completed", verdict: "unknown" });
  });

  it("keeps the health path on the preview origin", async () => {
    const o = await httpHealth({ previewUrl: PREVIEW, commit, path: "https://evil.example.com/x", fetch: never });
    expect(o.verdict).toBe("fail");
    expect(String(o.observations[0])).toMatch(/previewUrl rejected: health path leaves the preview origin/);
  });
});
