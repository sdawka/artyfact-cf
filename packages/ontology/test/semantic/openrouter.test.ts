import { describe, expect, it } from "vitest";
import {
  canon, DEFAULT_OPENROUTER_MODEL, evaluateAndJudge, loadTemplate, OPENROUTER_DECISIONS_URL, openRouterProvider, providerFromEnv,
  readDecision, S1Error, withSemanticProbes, type Graph, type S1Questions,
} from "../../src/index.ts";
import { productSpec } from "../../src/adapters/product/index.ts";
import { probeFindings, SETTINGS_V1 as SETTINGS } from "./vocabularies.ts";

const KEY = "sk-or-v1-TESTKEY-0123456789abcdef";

type Call = { url: string; init: RequestInit; body: any };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that records requests and answers each with `respond(body, n)`. */
function mockFetch(respond: (body: any, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    return respond(body, calls.length);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const QUESTIONS: S1Questions = {
  yn: { type: "noul", instructions: "Is it vague?", criteria: { true: "Vague", false: "Concrete" }, benign: "no" },
  pick: { type: "choice", instructions: "Which kind?", criteria: { a: "A", b: "B" }, benign: "a" },
  rate: { type: "score", instructions: "How clear?", criteria: ["low", "mid", "high"], benign: 2 },
};
const GOOD = {
  id: "gen-dec-1", model: "perplexity/pplx-decider-v1.1-27b-20261001", provider: "Perplexity",
  answers: {
    yn: { type: "noul", noul: 0.93 },
    pick: { type: "choice", choice: "b", probabilities: { a: 0.08, b: 0.92 }, confidence: 0.92 },
    rate: { type: "score", score: 1.2, probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 }, legend: { 0: "low" }, confidence: 0.6 },
  },
  usage: { cost: 0.00001, input_tokens: 321, output_tokens: 0 },
};

describe("openRouterProvider wire format", () => {
  it("posts model, state and the three primitives without benign, with the key only in the Authorization header", async () => {
    const { f, calls } = mockFetch(() => reply(GOOD));
    const s1 = openRouterProvider({ apiKey: KEY, fetch: f });
    expect(s1).toMatchObject({ mode: "http", model: DEFAULT_OPENROUTER_MODEL });
    const r = await s1.ask({ subject: "x" }, QUESTIONS);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.url).toBe(OPENROUTER_DECISIONS_URL);
    expect(c.init.method).toBe("POST");
    expect(c.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
    expect(c.body).toEqual({
      model: "perplexity/pplx-decider-v1.1-27b",
      state: { subject: "x" },
      questions: {
        yn: { type: "noul", instructions: "Is it vague?", criteria: { true: "Vague", false: "Concrete" } },
        pick: { type: "choice", instructions: "Which kind?", criteria: { a: "A", b: "B" } },
        rate: { type: "score", instructions: "How clear?", criteria: ["low", "mid", "high"] },
      },
    });
    expect(JSON.stringify(c.body)).not.toContain(KEY);
    expect(r).toMatchObject({ provider: "openrouter", model: GOOD.model, usage: { input_tokens: 321, output_tokens: 0 } });
    expect(r.answers.yn).toEqual({ type: "noul", noul: 0.93 });
    expect(r.answers.pick).toEqual({ type: "choice", choice: "b", probabilities: { a: 0.08, b: 0.92 }, confidence: 0.92 });
    expect(r.answers.rate).toMatchObject({ type: "score", score: 1, confidence: 0.6, legend: { 0: "low" } });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("model is a constructor option", async () => {
    const { f, calls } = mockFetch(() => reply({ ...GOOD, model: undefined }));
    const r = await openRouterProvider({ apiKey: KEY, model: "cloudflare/clef", fetch: f }).ask({}, { yn: QUESTIONS.yn });
    expect(calls[0].body.model).toBe("cloudflare/clef");
    expect(r.model).toBe("cloudflare/clef");
  });

  it("reads decisions: choice confidence falls back to its probability, score to the argmax level", () => {
    expect(readDecision("choice", { choice: "a", probabilities: { a: 0.7, b: 0.3 } })).toMatchObject({ choice: "a", confidence: 0.7 });
    expect(readDecision("score", { score: 2.6, probabilities: { 0: 0.05, 1: 0.15, 2: 0.4, 3: 0.4 } })).toMatchObject({ score: 2, confidence: 0.4 });
    expect(readDecision("noul", { noul: 1.2 })).toBeUndefined();
    expect(readDecision("noul", { noul: "0.9" })).toBeUndefined();
    expect(readDecision("choice", { choice: "a" })).toBeUndefined();
    expect(readDecision("score", { score: 1, probabilities: {} })).toBeUndefined();
  });

  it("caches identical asks", async () => {
    const { f, calls } = mockFetch(() => reply(GOOD));
    const s1 = openRouterProvider({ apiKey: KEY, fetch: f });
    await s1.ask({ a: 1 }, QUESTIONS);
    await s1.ask({ a: 1 }, QUESTIONS);
    expect(calls).toHaveLength(1);
  });

  it("limits requests in flight", async () => {
    let active = 0, peak = 0;
    const { f } = mockFetch(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return reply({ answers: { yn: { type: "noul", noul: 0.1 } } });
    });
    const s1 = openRouterProvider({ apiKey: KEY, fetch: f, concurrency: 2 });
    await Promise.all(Array.from({ length: 7 }, (_, i) => s1.ask({ i }, { yn: QUESTIONS.yn })));
    expect(peak).toBe(2);
  });
});

describe("openRouterProvider failures", () => {
  const hang = (() => (_url: string, init: RequestInit) => new Promise<Response>((_, reject) =>
    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as () => typeof fetch;

  it("times out as an S1Error and retries a timeout", async () => {
    let n = 0;
    const f = ((url: string, init: RequestInit) => { n++; return (hang() as any)(url, init); }) as typeof fetch;
    const s1 = openRouterProvider({ apiKey: KEY, fetch: f });
    await expect(s1.ask({}, { yn: QUESTIONS.yn }, { timeoutMs: 10, retries: 1, backoffMs: 1 })).rejects.toMatchObject({ name: "S1Error", code: "timeout" });
    expect(n).toBe(2);
  });

  it("retries 429 and 5xx, not 4xx", async () => {
    const flaky = mockFetch((_b, n) => (n === 1 ? reply({ error: { code: 429, message: "slow down" } }, 429) : n === 2 ? reply({}, 524) : reply(GOOD)));
    await expect(openRouterProvider({ apiKey: KEY, fetch: flaky.f }).ask({}, QUESTIONS, { retries: 2, backoffMs: 1 })).resolves.toMatchObject({ provider: "openrouter" });
    expect(flaky.calls).toHaveLength(3);
    const bad = mockFetch(() => reply({ error: { code: 400, message: "bad model" } }, 400));
    await expect(openRouterProvider({ apiKey: KEY, fetch: bad.f }).ask({}, QUESTIONS, { retries: 2, backoffMs: 1 }))
      .rejects.toMatchObject({ code: "http", status: 400, message: "OpenRouter HTTP 400: bad model" });
    expect(bad.calls).toHaveLength(1);
  });

  it("an error body with HTTP 200 is an http error", async () => {
    const { f } = mockFetch(() => reply({ error: { code: 403, message: "model not allowed" } }));
    await expect(openRouterProvider({ apiKey: KEY, fetch: f }).ask({}, QUESTIONS, { retries: 0 })).rejects.toMatchObject({ code: "http", status: 403 });
  });

  it.each([
    ["not JSON", () => new Response("<html>oops</html>", { status: 200 })],
    ["no answers", () => reply({ model: "m" })],
    ["answers is a list", () => reply({ answers: [] })],
    ["a missing answer", () => reply({ answers: { yn: { type: "noul", noul: 0.4 } } })],
    ["a wrong primitive", () => reply({ ...GOOD, answers: { ...GOOD.answers, pick: { type: "noul", noul: 0.2 } } })],
  ])("a malformed reply (%s) is bad-response", async (_name, respond) => {
    const { f } = mockFetch(respond);
    await expect(openRouterProvider({ apiKey: KEY, fetch: f }).ask({}, QUESTIONS, { retries: 0 })).rejects.toMatchObject({ code: "bad-response" });
  });

  it("refuses an empty key", () => {
    expect(() => openRouterProvider({ apiKey: "" })).toThrow(S1Error);
  });
});

describe("through judge", () => {
  const template = loadTemplate(withSemanticProbes(productSpec, SETTINGS.product));
  const graph: Graph = {
    template: "template.meta.product-spec@1",
    nodes: [
      { id: "$spec", kind: "spec", fields: {} },
      { id: "p", kind: "purpose", parent: "$spec", fields: { title: "P", description: "Works with no signal." } },
      { id: "r", kind: "rule", parent: "$spec", fields: { title: "R", description: "Needs a live connection." } },
    ],
    links: [], declarations: [], evidence: [],
  };

  it("a malformed reply leaves every candidate unknown with a provider error, and no text carries the key", async () => {
    const { f } = mockFetch(() => reply({ answers: { other: { type: "noul", noul: 0.9 } } }));
    const r = await evaluateAndJudge(template, graph, openRouterProvider({ apiKey: KEY, fetch: f }), { ask: { retries: 0 } });
    const probes = probeFindings(r);
    expect(probes.length).toBeGreaterThan(0);
    for (const x of probes) {
      expect(x).toMatchObject({ level: "info", judgment: { status: "unknown" }, provenance: { provider: "error", model: DEFAULT_OPENROUTER_MODEL, error: { code: "bad-response" } } });
    }
    expect(canon(r)).not.toContain(KEY);
  });

  it("a network error echoing the key is redacted in provenance", async () => {
    const f = (async () => { throw new TypeError(`connect failed for Bearer ${KEY}`); }) as unknown as typeof fetch;
    const r = await evaluateAndJudge(template, graph, openRouterProvider({ apiKey: KEY, fetch: f }), { ask: { retries: 0 } });
    const [x] = probeFindings(r);
    expect(x.provenance?.error).toMatchObject({ code: "network", message: "OpenRouter network error: connect failed for Bearer [redacted]" });
    expect(canon(r)).not.toContain(KEY);
    expect(JSON.stringify(openRouterProvider({ apiKey: KEY }))).not.toContain(KEY);
  });

  it("a confident contradiction becomes an error with openrouter provenance", async () => {
    const { f, calls } = mockFetch((b) => reply({ model: "pplx-dated", answers: { [Object.keys(b.questions)[0]]: { type: "noul", noul: Object.keys(b.questions)[0] === "pair.contradiction" ? 0.97 : 0.02 } } }));
    const r = await evaluateAndJudge(template, graph, openRouterProvider({ apiKey: KEY, fetch: f }));
    const pair = r.findings.find((x) => x.rule === "semantic:pair.contradiction")!;
    expect(pair).toMatchObject({ level: "error", subject: "p|r", judgment: { status: "confident", answer: "yes", confidence: 0.97 }, provenance: { provider: "openrouter", model: "pplx-dated" } });
    const sent = calls.find((c) => "pair.contradiction" in c.body.questions)!;
    expect(sent.body.state).toMatchObject({ subject: { id: "p" }, counterpart: { id: "r" } });
    expect(sent.body.questions["pair.contradiction"].criteria.true).toMatch(/^Contradict/);
  });
});

describe("providerFromEnv", () => {
  const never = (() => { throw new Error("must not fetch"); }) as unknown as typeof fetch;

  it("FAKE_S1=1 wins over a key and never fetches", async () => {
    const s1 = providerFromEnv({ FAKE_S1: "1", OPENROUTER_API_KEY: KEY, fetch: never });
    expect(s1.mode).toBe("fake");
    await expect(s1.ask({}, { yn: QUESTIONS.yn })).resolves.toMatchObject({ provider: "fake" });
  });

  it("a key selects OpenRouter with the default or OPENROUTER_MODEL", () => {
    expect(providerFromEnv({ OPENROUTER_API_KEY: KEY })).toMatchObject({ mode: "http", model: DEFAULT_OPENROUTER_MODEL });
    expect(providerFromEnv({ OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "cloudflare/clef" })).toMatchObject({ mode: "http", model: "cloudflare/clef" });
    expect(providerFromEnv({ FAKE_S1: "0", OPENROUTER_API_KEY: KEY }).mode).toBe("http");
  });

  it("no key, or a blank one, is off", async () => {
    for (const env of [{}, { OPENROUTER_API_KEY: "  " }, { FAKE_S1: "true" }]) {
      const s1 = providerFromEnv(env);
      expect(s1.mode).toBe("off");
      await expect(s1.ask({}, {})).rejects.toMatchObject({ code: "off" });
    }
  });
});
