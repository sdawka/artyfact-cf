import { afterEach, describe, expect, it, vi } from "vitest";
import { systems } from "../../worker/routes/systems";
import { HOSTED_DEMO_NOTICE, isHostedDemo } from "../../worker/demo";
import { defaultHookRunner } from "../../worker/hooks";
import type { CandidateRef, FileMap, SubmissionContext } from "../../worker/hooks/contract";
import { createHookRunner } from "../../worker/hooks/run";
import { SIMULATED } from "../../worker/hooks/visual";
import { intentProviders } from "../../worker/intents";
import { demoPlanner } from "../../worker/tasks/planner-llm";
import { BASE, COMMIT, miniGenome } from "./fixtures";

const CRITERION = "C.webapp.look";

/** The mini-Genome plus a soft criterion with a platform visual check. */
function withVisual(): FileMap {
  const path = "thing.webapp/node.yaml", files = miniGenome();
  const block = `  - id: ${CRITERION}
    title: People screen looks right
    claim: "The people screen reads clearly at desktop and mobile widths."
    target: observation
    severity: soft
    gates:
      - candidate
    hooks:
      - id: hook.webapp.look
        assay: webapp.look
        tier: semantic
        engine: browser
        triggers:
          - candidate
        inputs:
          judgment: "visual"
          path: "/people"
        timeoutMs: 60000
        costTier: expensive
`;
  return { ...files, [path]: files[path].replace("criteria:\n", `criteria:\n${block}`) };
}

const candidate: CandidateRef = {
  id: "cand.r1", realizationId: "realization.1.r1", evolutionId: "evolution.api", target: "app", commit: COMMIT, baseCommit: BASE,
  changedPaths: [], changedNodes: [], previewUrl: "https://peopling-r1.dawka.workers.dev",
  screenshots: [{ key: "evidence/system.mini-peopling/realization.1.r1/x/agent-1-abc.png", name: "a.png", mediaType: "image/png", bytes: 10, sha256: "s" }],
};
const ctx: SubmissionContext = {
  systemId: "system.mini-peopling", candidate, genomeCommit: BASE, genomeFiles: withVisual(), tree: [], permittedPaths: ["src/**"], protectedPaths: [],
  openCandidates: [], evolution: { id: "evolution.api", kind: "implementation", acceptanceCriteria: [CRITERION], affectedNodes: [], state: "actionable" },
};

/** A hosted-demo env whose model keys and bindings throw when read: the demo must never touch them. */
function demoEnv(read: string[] = []) {
  const forbidden = ["AI", "BROWSER", "EVIDENCE", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "S1_PROVIDER", "FAKE_S1", "CLEF_MODEL", "JEV_MODEL", "OPENROUTER_MODEL", "OPENROUTER_TRANSLATE_MODEL", "OPENROUTER_PLAN_MODEL", "TRANSLATE"];
  return new Proxy({ HOSTED_DEMO: "1" } as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === "string" && forbidden.includes(key)) { read.push(key); throw new Error(`hosted demo read ${key}`); }
      return target[key as string];
    },
  }) as unknown as Env;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("hosted demo", () => {
  it("is on only for HOSTED_DEMO=1", () => {
    expect(isHostedDemo({ HOSTED_DEMO: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true"]) expect(isHostedDemo({ HOSTED_DEMO: v })).toBe(false);
  });

  it("judges with the simulated provider and a simulated visual check, never reading keys, AI, Browser Run or the network", async () => {
    const read: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/typesafe|openrouter|cloudflare\.com/.test(url)) throw new Error(`hosted demo fetched ${url}`);
      return new Response("ok", { status: 200 });
    });
    const evs = await defaultHookRunner(demoEnv(read), createHookRunner).runSubmission(ctx);
    expect(read).toEqual([]);
    expect(fetchSpy.mock.calls.map(([u]) => String(u instanceof Request ? u.url : u)).filter((u) => /typesafe|openrouter|cloudflare\.com/.test(u))).toEqual([]);
    const visual = evs.find((e) => e.criterion === CRITERION)!;
    expect(visual).toMatchObject({ execution: "completed", provenance: { provider: "simulated", model: "simulated", simulated: "hosted-demo", images: "0" } });
    expect(visual.limitations.join(" ")).toContain(SIMULATED);
    for (const e of evs.filter((x) => x.provenance.provider && !["none", "rules", "off", ""].includes(x.provenance.provider))) {
      expect(e.provenance.provider.split(",").every((p) => p === "simulated" || p === "none"), `${e.criterion}: ${e.provenance.provider}`).toBe(true);
    }
  });

  it("intent routing, translation and the plan drafter are deterministic mocks", async () => {
    const read: string[] = [];
    const p = intentProviders(demoEnv(read));
    expect(p.s1).toMatchObject({ mode: "fake", model: "simulated" });
    expect(p.translator.mode).toBe("fake");
    expect(demoPlanner().mode).toBe("fake");
    expect(read).toEqual([]);
  });

  it("GET /api/platform says whether this is the hosted demo", async () => {
    const on = await systems.request("/platform", {}, { HOSTED_DEMO: "1" });
    expect(await on.json()).toEqual({ hostedDemo: true, notice: HOSTED_DEMO_NOTICE, catMode: false });
    expect(HOSTED_DEMO_NOTICE).toBe("Hosted demo: judgments are simulated. Run it locally on your Cloudflare account for Clef or Jev.");
    const off = await systems.request("/platform", {}, { HOSTED_DEMO: "0" });
    expect(await off.json()).toEqual({ hostedDemo: false, catMode: false });
  });

  it("GET /api/platform reads the cat-mode Flagship flag; absent or failing reads as off", async () => {
    const asked: [string, boolean][] = [];
    const on = { getBooleanValue: async (key: string, fallback: boolean) => { asked.push([key, fallback]); return true; } };
    const res = await systems.request("/platform", {}, { HOSTED_DEMO: "0", FLAGS: on });
    expect(await res.json()).toEqual({ hostedDemo: false, catMode: true });
    expect(asked).toEqual([["cat-mode", false]]);
    const absent = await systems.request("/platform", {}, { HOSTED_DEMO: "0" });
    expect(await absent.json()).toEqual({ hostedDemo: false, catMode: false });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { getBooleanValue: async () => { throw new Error("flagship down"); } };
    const failed = await systems.request("/platform", {}, { HOSTED_DEMO: "1", FLAGS: broken });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ hostedDemo: true, notice: HOSTED_DEMO_NOTICE, catMode: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
