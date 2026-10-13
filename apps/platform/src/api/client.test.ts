import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError, FixtureModeError, SSE_TYPES, StaleBaseError, commitFiles, createEvolution, getBuilds, getChangelog, getChangelogEntry,
  getClientMode, getCompareFile, getCompareGenome, getCompareSystem, getDeployments, getEvaluations, getFile, getModel, getPhenomeEvents, getParts, getRealizedArtifacts,
  getRevisions, getSystems, listFiles, promote, resetClientMode, startWork, subscribeEvents,
} from "./client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => resetClientMode());
afterEach(() => vi.unstubAllGlobals());

describe("api client fixture fallback", () => {
  it("serves the fixture bundle when /api/systems fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: { code: "not-found", message: "no" } })));
    const b = await getModel("system.keep-in-touch", "head");
    expect(b.source).toBe("fixture");
    expect(b.model.system.id).toBe("system.keep-in-touch");
    expect((await getSystems())[0]?.systemId).toBe("system.keep-in-touch");
    expect(await getEvaluations("system.keep-in-touch")).toEqual({ evaluations: [] });
    await expect(startWork("system.keep-in-touch", "evolution.1")).rejects.toBeInstanceOf(FixtureModeError);
  });

  it("treats an empty /api/systems as a real, empty platform (not fixture mode)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { systems: [] })));
    expect(await getSystems()).toEqual([]);
    expect(await getClientMode()).toBe("api");
  });

  it("reports fixture mode when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await getClientMode()).toBe("fixture");
  });

  it("uses the API when systems exist and types a 409 stale base", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/systems") return json(200, [{ systemId: "system.x" }]);
      if (url.startsWith("/api/systems/system.x/model"))
        return json(200, { systemId: "system.x", revision: "head", genomeCommit: "abc", model: { system: { id: "system.x" } }, readiness: {} });
      if (url.endsWith("/promote"))
        return json(409, { error: { code: "stale-base", message: "moved", details: { currentHead: "c2" } } });
      return json(500, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await getModel("system.x", "head")).source).toBe("api");
    const err = await promote("system.x", { candidates: ["c"], expectedHead: "c1", rationale: "r" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleBaseError);
    expect((err as StaleBaseError).currentHead).toBe("c2");
  });
});

describe("subscribeEvents", () => {
  it("polls only after the EventSource is CLOSED, not on a transient error", async () => {
    vi.useFakeTimers();
    const sources: FakeSource[] = [];
    class FakeSource {
      static CLOSED = 2;
      readyState = 0;
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        sources.push(this);
      }
      addEventListener() {}
      close() {
        this.readyState = 2;
      }
    }
    vi.stubGlobal("EventSource", FakeSource);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [{ systemId: "system.x" }])));
    const onEvent = vi.fn();
    const stop = subscribeEvents("system.x", onEvent, { pollMs: 100 });
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    sources[0]!.readyState = 0; // reconnecting
    sources[0]!.onerror?.();
    vi.advanceTimersByTime(250);
    expect(onEvent).not.toHaveBeenCalled();
    sources[0]!.readyState = FakeSource.CLOSED;
    sources[0]!.onerror?.();
    vi.advanceTimersByTime(250);
    expect(onEvent).toHaveBeenCalledWith({ type: "poll" });
    stop();
    vi.useRealTimers();
  });

  it("logs why it fell back to fixture data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => json(503, { error: { code: "down", message: "down" } })));
    await getSystems();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("iteration-2 reads and writes", () => {
  const live = () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/systems") return json(200, { systems: [{ systemId: "s" }] });
      return json(200, { ok: url });
    }));
    return calls;
  };

  it("maps the UI's repo/rev to the API's scope/ref and calls the contract paths", async () => {
    const calls = live();
    await listFiles("s", { repo: "app", rev: "sc-2" });
    await getFile("s", { repo: "genome", rev: "head", path: "things/web app.yaml" });
    await getCompareFile("s", { repo: "app", from: "sc-1", to: "sc-2", path: "src/a.ts" });
    await getCompareSystem("s", { to: "sc-2" });
    await getCompareGenome("s", { from: "sc-1", to: "head" });
    await getChangelog("s", { limit: 20, before: "sc-9" });
    await getChangelogEntry("s", "sc-3");
    await getRevisions("s");
    await getBuilds("s", { commit: "abc", kind: "preview" });
    await getBuilds("s", { realization: "r1" });
    await getDeployments("s");
    await getPhenomeEvents("s", { deployment: "d1", limit: 50 });
    await getParts();
    await getRealizedArtifacts("s");
    expect(calls.slice(1).map((c) => c.url)).toEqual([
      "/api/systems/s/files?scope=app&ref=sc-2",
      "/api/systems/s/file?scope=genome&ref=head&path=things%2Fweb%20app.yaml",
      "/api/systems/s/compare/file?scope=app&from=sc-1&to=sc-2&path=src%2Fa.ts",
      "/api/systems/s/compare/system?to=sc-2",
      "/api/systems/s/compare/genome?from=sc-1&to=head",
      "/api/systems/s/changelog?limit=20&before=sc-9",
      "/api/systems/s/changelog/sc-3",
      "/api/systems/s/revisions",
      "/api/systems/s/builds?commit=abc&kind=preview",
      "/api/systems/s/realizations/r1/builds",
      "/api/systems/s/deployments",
      "/api/systems/s/phenome/events?deployment=d1&limit=50",
      "/api/parts",
      "/api/systems/s/artifacts",
    ]);
  });

  it("createEvolution and commitFiles POST with a bearer token", async () => {
    const calls = live();
    await createEvolution("s", { title: "T", intent: "I" }, "admin-tok");
    await commitFiles("s", "r1", { message: "m", changes: [{ path: "a", content: null }] }, "secret");
    const [create, commit] = calls.slice(1);
    expect(create!.url).toBe("/api/systems/s/evolutions");
    expect((create!.init!.headers as Record<string, string>).authorization).toBe("Bearer admin-tok");
    expect(commit!.url).toBe("/api/systems/s/realizations/r1/commit");
    expect((commit!.init!.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(commit!.init!.body as string)).toEqual({ message: "m", changes: [{ path: "a", content: null }] });
  });

  it("in fixture mode serves Genome files, head-only revisions and empty lists, and refuses writes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const tree = await listFiles("system.keep-in-touch", { repo: "genome" });
    expect(tree.files.map((f) => f.path)).toContain("system.yaml");
    const file = await getFile("system.keep-in-touch", { repo: "genome", path: "system.yaml" });
    expect(file.text).toContain("system.keep-in-touch");
    expect((await listFiles("system.keep-in-touch", { repo: "app" })).files).toEqual([]);
    expect((await getRevisions("system.keep-in-touch")).revisions).toEqual([{ id: "head", kind: "head", label: "head" }]);
    expect(await getChangelog("system.keep-in-touch")).toEqual({ rows: [] });
    expect(await getBuilds("system.keep-in-touch")).toEqual({ builds: [] });
    expect(await getDeployments("system.keep-in-touch")).toEqual({ production: null, history: [] });
    expect(await getPhenomeEvents("system.keep-in-touch")).toEqual({ events: [], versions: [] });
    await expect(getChangelogEntry("system.keep-in-touch", "sc-1")).rejects.toBeInstanceOf(ApiRequestError);
    await expect(getFile("system.keep-in-touch", { repo: "app", path: "src/index.ts" })).rejects.toBeInstanceOf(ApiRequestError);
    await expect(createEvolution("system.keep-in-touch", { title: "T", intent: "I" })).rejects.toBeInstanceOf(FixtureModeError);
    await expect(commitFiles("system.keep-in-touch", "r", { message: "m", changes: [] })).rejects.toBeInstanceOf(FixtureModeError);
  });

  it("zero-fills the fixture summary's iteration-2 fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(503, {})));
    const [s] = await getSystems();
    expect(s).toMatchObject({ built: false, latestBuild: null, deployState: "none", signifiers: [], deployment: { production: null, previews: 0 } });
  });

  it("listens for the new SSE types", () => {
    expect(SSE_TYPES).toEqual(expect.arrayContaining(["build.updated", "deployment.updated", "phenome.ingested", "system.updated", "evolution.created", "system.imported"]));
  });
});
