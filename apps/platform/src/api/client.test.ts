import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixtureModeError, StaleBaseError, getEvaluations, getModel, getSystems, promote, resetClientMode, startWork } from "./client";

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

  it("serves the fixture when /api/systems is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));
    expect((await getModel("system.keep-in-touch", "head")).source).toBe("fixture");
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
