import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";
import { ApiRequestError } from "./client";
import { ManualCommitError, SSE_INVALIDATIONS, qk, useManualCommit, useSystemEvents, type ManualCommitInput } from "./queries";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function Probe({ input }: { input: ManualCommitInput }) {
  const m = useManualCommit();
  return (
    <div>
      <button onClick={() => m.mutate(input)}>go</button>
      <output data-testid="out">{m.data ? JSON.stringify({ r: m.data.realizationId, e: m.data.evolutionId, c: m.data.result.commit }) : m.error?.message ?? ""}</output>
      <output data-testid="err">{m.error instanceof ManualCommitError ? JSON.stringify({ step: m.error.step, ...m.error.progress, status: (m.error.cause as ApiRequestError).status }) : ""}</output>
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

describe("useManualCommit failures and resume", () => {
  type Call = { url: string; auth?: string };
  const stub = (fail: "start" | "commit" | null) => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      if (url === "/api/systems") return json(200, { systems: [{ systemId: "s" }] });
      if (url === "/api/systems/s/evolutions") return json(201, { evolution: { id: "evolution.9" } });
      if (url.endsWith("/realizations") && init?.method === "POST")
        return fail === "start" ? json(500, { error: { code: "boom", message: "start failed" } }) : json(201, { realization: { id: "r9" }, secret: "sec" });
      if (url.endsWith("/commit"))
        return fail === "commit" ? json(409, { error: { code: "head-moved", message: "fork head moved" } }) : json(200, { commit: "c".repeat(40), parent: "p", tree: "t", submitted: {} });
      return json(404, {});
    }));
    return calls;
  };
  const run = (input: ManualCommitInput) => {
    renderApp("/s/s/r/head/p", [{ path: "/s/:systemId/r/:rev/p", element: <Probe input={input} /> }]);
    act(() => screen.getByRole("button", { name: "go" }).click());
  };
  const commit = { message: "m", changes: [{ path: "a", content: "x" }] };

  it("keeps the new Evolution id when startWork fails", async () => {
    stub("start");
    run({ newEvolution: { title: "T", intent: "I" }, adminToken: "adm", commit });
    await waitFor(() => expect(JSON.parse(screen.getByTestId("err").textContent!)).toEqual({ step: "startWork", evolutionId: "evolution.9", status: 500 }));
  });

  it("keeps the realization id and its one-time secret when the commit fails", async () => {
    stub("commit");
    run({ evolutionId: "evolution.9", adminToken: "adm", commit });
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("err").textContent!)).toEqual({ step: "commit", evolutionId: "evolution.9", realizationId: "r9", secret: "sec", status: 409 }));
  });

  it("resumes with an existing realization and secret without creating or starting anything", async () => {
    const calls = stub(null);
    run({ realizationId: "r9", secret: "sec", evolutionId: "evolution.9", commit });
    await waitFor(() => expect(screen.getByTestId("out").textContent).toContain('"r":"r9"'));
    expect(calls.slice(1)).toEqual([{ url: "/api/systems/s/realizations/r9/commit", auth: "Bearer sec" }]);
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
    expect(SSE_INVALIDATIONS.ping).toEqual([]);
  });
});

describe("useSystemEvents", () => {
  class FakeSource {
    static CLOSED = 2;
    static last: FakeSource | undefined;
    readyState = 1;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      FakeSource.last = this;
    }
    addEventListener() {}
    close() {
      this.readyState = 2;
    }
  }
  function Events() {
    useSystemEvents();
    return null;
  }
  const mount = () => {
    vi.stubGlobal("EventSource", FakeSource);
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { systems: [{ systemId: "s" }] })));
    const { qc } = renderApp("/s/s/r/head/p", [{ path: "/s/:systemId/r/:rev/p", element: <Events /> }]);
    return vi.spyOn(qc, "invalidateQueries");
  };
  const send = (data: unknown) => act(() => FakeSource.last!.onmessage!({ data: JSON.stringify(data) } as MessageEvent<string>));

  it("ignores pings and invalidates per event type", async () => {
    const spy = mount();
    await waitFor(() => expect(FakeSource.last?.url).toBe("/api/systems/s/events"));
    send({ type: "ping", at: "" });
    expect(spy).not.toHaveBeenCalled();
    send({ type: "phenome.ingested", count: 1, commit: "c", at: "" });
    expect(spy.mock.calls.map((c) => c[0]!.queryKey)).toEqual([["phenome", "s"], ["systems"]]);
  });

  it("the polling fallback refreshes the live lists", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = mount();
    await waitFor(() => expect(FakeSource.last).toBeTruthy());
    act(() => {
      FakeSource.last!.readyState = FakeSource.CLOSED;
      FakeSource.last!.onerror!();
    });
    act(() => void vi.advanceTimersByTime(3_100));
    const keys = spy.mock.calls.map((c) => c[0]!.queryKey);
    expect(keys).toEqual(expect.arrayContaining([["builds", "s"], ["deployments", "s"], ["changelog", "s"], ["systems"]]));
    vi.useRealTimers();
  });
});
