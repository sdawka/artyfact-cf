import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";
import { SSE_INVALIDATIONS, qk, useManualCommit, type ManualCommitInput } from "./queries";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function Probe({ input }: { input: ManualCommitInput }) {
  const m = useManualCommit();
  return (
    <div>
      <button onClick={() => m.mutate(input)}>go</button>
      <output data-testid="out">{m.data ? JSON.stringify({ r: m.data.realizationId, e: m.data.evolutionId, c: m.data.result.commit }) : m.error?.message ?? ""}</output>
    </div>
  );
}

describe("useManualCommit", () => {
  it("creates the Evolution, starts an editor realization and commits with its secret", async () => {
    const calls: { url: string; auth?: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === "/api/systems") return json(200, { systems: [{ systemId: "s" }] });
      if (url === "/api/systems/s/evolutions") return json(201, { evolution: { id: "evolution.9" } });
      if (url.endsWith("/evolutions/evolution.9/realizations")) return json(201, { realization: { id: "r9" }, secret: "sec" });
      if (url.endsWith("/realizations/r9/commit")) return json(200, { commit: "c".repeat(40), parent: "p", tree: "t", submitted: {} });
      return json(404, {});
    }));
    const input: ManualCommitInput = {
      newEvolution: { title: "Fix copy", intent: "Typo" }, adminToken: "adm",
      commit: { message: "Fix typo", changes: [{ path: "src/a.ts", content: "x" }] },
    };
    const { qc } = renderApp("/s/s/r/head/p", [{ path: "/s/:systemId/r/:rev/p", element: <Probe input={input} /> }]);
    const spy = vi.spyOn(qc, "invalidateQueries");
    act(() => screen.getByRole("button", { name: "go" }).click());
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe(JSON.stringify({ r: "r9", e: "evolution.9", c: "c".repeat(40) })));
    expect(calls.slice(1).map((c) => [c.url, c.auth])).toEqual([
      ["/api/systems/s/evolutions", "Bearer adm"],
      ["/api/systems/s/evolutions/evolution.9/realizations", "Bearer adm"],
      ["/api/systems/s/realizations/r9/commit", "Bearer sec"],
    ]);
    expect(calls[2]!.body).toMatchObject({ origin: "editor", target: "app" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["builds", "s"] }));
  });
});

describe("query keys and SSE invalidations", () => {
  it("keys start with [name, systemId] so prefix invalidation reaches every variant", () => {
    expect(qk.tree("s", "app", "head").slice(0, 2)).toEqual(["tree", "s"]);
    expect(qk.compare("s", "system", undefined, "sc-2")).toEqual(["compare", "s", "system", null, "sc-2"]);
    expect(qk.builds("s", { realization: "r1" }).slice(0, 2)).toEqual(["builds", "s"]);
  });

  it("maps the new SSE events to the queries they change", () => {
    expect(SSE_INVALIDATIONS["build.updated"]).toEqual(expect.arrayContaining(["builds", "candidates", "changelog", "systems"]));
    expect(SSE_INVALIDATIONS["deployment.updated"]).toEqual(expect.arrayContaining(["deployments", "systems"]));
    expect(SSE_INVALIDATIONS["phenome.ingested"]).toEqual(["phenome", "systems"]);
    expect(SSE_INVALIDATIONS["system.updated"]).toEqual(["systems"]);
    expect(SSE_INVALIDATIONS["evolution.created"]).toContain("evolutions");
    expect(SSE_INVALIDATIONS["system.promoted"]).toEqual(expect.arrayContaining(["changelog", "revisions"]));
  });
});
