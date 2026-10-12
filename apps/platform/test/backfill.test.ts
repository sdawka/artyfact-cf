import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { SystemSummary, SystemsResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { REGISTRY, setSseLifetime, type SystemAuthority } from "../worker/do/system-authority";
import { isVersionSkew } from "../worker/index";
import { call, importFresh } from "./helpers/flows";

afterEach(() => {
  setArtifactsOverride(undefined);
  setSseLifetime(undefined);
});

describe("GET /api/systems backfill", () => {
  it("recomputes a registry row written before summaries had signifiers", async () => {
    const f = await importFresh();
    // A pre-B5 row: only the original fields.
    await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => {
      const { systemId, title, head, genomeRepo, appRepo, genomeCommit, phase, evolutionCounts, updatedAt } = i.listSystems().find((s) => s.systemId === f.systemId)!;
      i.registerSystem({ systemId, title, head, genomeRepo, appRepo, genomeCommit, phase, evolutionCounts, updatedAt } as SystemSummary);
    });
    const before = await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => i.listSystems().find((s) => s.systemId === f.systemId)!);
    expect(before.signifiers).toBeUndefined();

    const row = (await call<SystemsResponse>("GET", "/systems")).json.systems.find((s) => s.systemId === f.systemId)!;
    expect(row.signifiers).toEqual(expect.arrayContaining(["not-fully-built"]));
    expect(row).toMatchObject({ built: false, deployState: "none", latestBuild: null });
    // Persisted: the registry now holds the full row.
    const after = await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => i.listSystems().find((s) => s.systemId === f.systemId)!);
    expect(Array.isArray(after.signifiers)).toBe(true);
  });
});

describe("SSE stream lifetime", () => {
  it("closes each stream after the lifetime cap", async () => {
    const f = await importFresh();
    setSseLifetime(50);
    const res = await exports.default.fetch(new Request(`http://example.com/api/systems/${f.systemId}/events`));
    const reader = res.body!.getReader();
    const closed = (async () => {
      for (;;) if ((await reader.read()).done) return true;
    })();
    expect(await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 2000))])).toBe(true);
  });
});

describe("version skew", () => {
  it("recognises the RPC 'does not implement the method' error", () => {
    expect(isVersionSkew(new TypeError('The RPC receiver does not implement the method "publishSummary".'))).toBe(true);
    expect(isVersionSkew(new Error("boom"))).toBe(false);
    expect(isVersionSkew(undefined)).toBe(false);
  });
});
