import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPLAIN_MODEL, EXPLAIN_SYSTEM_PROMPT, explainerFromEnv, fakeExplainer, offExplainer, OPENROUTER_CHAT_URL,
  openRouterExplainer, type ExplainRequest, type SliceState,
} from "../../src/index.ts";

const KEY = "sk-or-v1-TESTKEY-0123456789abcdef";

type Call = { url: string; init: RequestInit; body: any };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockFetch(respond: (body: any, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    return respond(body, calls.length);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const STATE: SliceState = {
  candidate: { rule: "semantic.contradiction", text: "Do these statements contradict?" },
  subject: { id: "need-1", kind: "need", fields: { text: "Must work offline" } },
  counterpart: { id: "need-2", kind: "need", fields: { text: "Always requires a live connection" } },
  parents: [],
  nodes: [],
  links: [],
};
const REQ: ExplainRequest = { defect: "contradiction", question: "Do these statements contradict?", answer: "yes", subjects: ["need-1", "need-2"] };
const GOOD = {
  id: "gen-1", model: "openai/gpt-6-luna-20261001",
  choices: [{ message: { role: "assistant", content: "  need-1 requires offline use while need-2 requires a live connection.  " } }],
  usage: { prompt_tokens: 412, completion_tokens: 23 },
};

describe("openRouterExplainer", () => {
  it("posts the system prompt and finding, sends Authorization and X-Title, and maps usage", async () => {
    const { f, calls } = mockFetch(() => reply(GOOD));
    const ex = openRouterExplainer({ apiKey: KEY, fetch: f, title: "test-title" });
    expect(ex).toMatchObject({ mode: "http", model: DEFAULT_EXPLAIN_MODEL });
    const r = await ex.explain(STATE, REQ);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.url).toBe(OPENROUTER_CHAT_URL);
    expect(c.init.method).toBe("POST");
    expect(c.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "X-Title": "test-title" });
    expect(c.body).toEqual({
      model: DEFAULT_EXPLAIN_MODEL,
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ finding: REQ, state: STATE }) },
      ],
      max_tokens: 200,
      temperature: 0,
    });
    expect(JSON.stringify(c.body)).not.toContain(KEY);
    expect(r).toEqual({
      text: "need-1 requires offline use while need-2 requires a live connection.",
      model: GOOD.model,
      provider: "openrouter",
      usage: { input_tokens: 412, output_tokens: 23 },
    });
  });

  it("takes model, url and maxTokens as options", async () => {
    const { f, calls } = mockFetch(() => reply({ ...GOOD, model: undefined, usage: undefined }));
    const r = await openRouterExplainer({ apiKey: KEY, fetch: f, model: "x/y", url: "https://example.test/chat", maxTokens: 50 }).explain(STATE, REQ);
    expect(calls[0].url).toBe("https://example.test/chat");
    expect(calls[0].body).toMatchObject({ model: "x/y", max_tokens: 50 });
    expect(r).toMatchObject({ model: "x/y", usage: { input_tokens: 0, output_tokens: 0 } });
  });

  it("retries a 429 and then succeeds", async () => {
    const { f, calls } = mockFetch((_b, n) => (n === 1 ? reply({ error: { code: 429, message: "slow down" } }, 429) : reply(GOOD)));
    const r = await openRouterExplainer({ apiKey: KEY, fetch: f }).explain(STATE, REQ, { backoffMs: 1 });
    expect(calls).toHaveLength(2);
    expect(r.provider).toBe("openrouter");
  });

  it("a timeout returns an error result instead of throwing", async () => {
    let n = 0;
    const hang = ((_url: string, init: RequestInit) => {
      n++;
      return new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }) as unknown as typeof fetch;
    const r = await openRouterExplainer({ apiKey: KEY, fetch: hang, timeoutMs: 10 }).explain(STATE, REQ, { retries: 1, backoffMs: 1 });
    expect(r).toEqual({ model: DEFAULT_EXPLAIN_MODEL, provider: "error", error: "OpenRouter timed out after 10 ms" });
    expect(n).toBe(2);
  });

  it("a 4xx is not retried and a malformed body is an error result", async () => {
    const bad = mockFetch(() => reply({ error: { code: 400, message: "bad model" } }, 400));
    expect(await openRouterExplainer({ apiKey: KEY, fetch: bad.f }).explain(STATE, REQ)).toMatchObject({ provider: "error", error: "OpenRouter HTTP 400: bad model" });
    expect(bad.calls).toHaveLength(1);
    const odd = mockFetch(() => reply({ choices: [] }));
    expect(await openRouterExplainer({ apiKey: KEY, fetch: odd.f }).explain(STATE, REQ)).toMatchObject({ provider: "error", error: "OpenRouter: malformed chat response" });
  });

  it("redacts the key from error text", async () => {
    const f = (async () => { throw new Error(`connect failed for Bearer ${KEY}`); }) as unknown as typeof fetch;
    const r = await openRouterExplainer({ apiKey: KEY, fetch: f }).explain(STATE, REQ);
    expect(r.provider).toBe("error");
    expect(r.error).toContain("[redacted]");
    expect(JSON.stringify(r)).not.toContain(KEY);
    const echo = mockFetch(() => reply({ error: { code: 401, message: `invalid key ${KEY}` } }, 401));
    const r2 = await openRouterExplainer({ apiKey: KEY, fetch: echo.f }).explain(STATE, REQ);
    expect(r2.error).toBe("OpenRouter HTTP 401: invalid key [redacted]");
  });

  it("caches identical requests and does not cache errors", async () => {
    const { f, calls } = mockFetch(() => reply(GOOD));
    const ex = openRouterExplainer({ apiKey: KEY, fetch: f });
    const a = await ex.explain(STATE, REQ);
    const b = await ex.explain(structuredClone(STATE), { ...REQ });
    expect(calls).toHaveLength(1);
    expect(b).toEqual(a);
    await ex.explain(STATE, { ...REQ, answer: "no" });
    expect(calls).toHaveLength(2);

    const flaky = mockFetch((_b, n) => (n === 1 ? reply({ error: { message: "nope" } }, 400) : reply(GOOD)));
    const ex2 = openRouterExplainer({ apiKey: KEY, fetch: flaky.f });
    expect((await ex2.explain(STATE, REQ)).provider).toBe("error");
    expect((await ex2.explain(STATE, REQ)).provider).toBe("openrouter");
  });

  it("limits requests in flight to concurrency, default 2", async () => {
    for (const [concurrency, want] of [[undefined, 2], [3, 3]] as const) {
      let active = 0, peak = 0;
      const { f } = mockFetch(async () => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return reply(GOOD);
      });
      const ex = openRouterExplainer({ apiKey: KEY, fetch: f, concurrency });
      await Promise.all(Array.from({ length: 7 }, (_, i) => ex.explain(STATE, { ...REQ, answer: String(i) })));
      expect(peak).toBe(want);
    }
  });

  it("refuses an empty key", () => {
    expect(() => openRouterExplainer({ apiKey: "" })).toThrow(/API key/);
  });
});

describe("fake, off and env precedence", () => {
  it("fake names the defect and subjects; off returns immediately", async () => {
    expect(await fakeExplainer().explain(STATE, REQ)).toEqual({ text: "[fake] contradiction on need-1 and need-2", model: "fake", provider: "fake" });
    expect(await offExplainer().explain(STATE, REQ)).toEqual({ model: "off", provider: "off" });
  });

  it("EXPLAIN=0 beats FAKE_S1 and a key; FAKE_S1 beats a key; a key gives OpenRouter; else off", async () => {
    const { f, calls } = mockFetch(() => reply(GOOD));
    expect(explainerFromEnv({ EXPLAIN: "0", FAKE_S1: "1", OPENROUTER_API_KEY: KEY, fetch: f }).mode).toBe("off");
    const fake = explainerFromEnv({ FAKE_S1: "1", OPENROUTER_API_KEY: KEY, fetch: f });
    expect(fake.mode).toBe("fake");
    await fake.explain(STATE, REQ);
    expect(calls).toHaveLength(0);
    expect(explainerFromEnv({ OPENROUTER_API_KEY: KEY })).toMatchObject({ mode: "http", model: DEFAULT_EXPLAIN_MODEL });
    expect(explainerFromEnv({ OPENROUTER_API_KEY: ` ${KEY} `, OPENROUTER_EXPLAIN_MODEL: " x/y " })).toMatchObject({ mode: "http", model: "x/y" });
    expect(explainerFromEnv({ OPENROUTER_API_KEY: "  " }).mode).toBe("off");
    expect(explainerFromEnv({}).mode).toBe("off");
    expect(explainerFromEnv({ EXPLAIN: "1", OPENROUTER_API_KEY: KEY }).mode).toBe("http");
  });
});
