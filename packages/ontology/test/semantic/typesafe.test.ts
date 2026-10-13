import { describe, expect, it } from "vitest";
import { DEFAULT_OPENROUTER_MODEL, DEFAULT_TYPESAFE_MODEL, providerFromEnv, TYPESAFE_URL, typeSafeProvider, type S1Questions } from "../../src/index.ts";

const KEY = "ts-TESTKEY-0123456789";
const QUESTIONS: S1Questions = {
  yn: { type: "noul", instructions: "Is it vague?", criteria: { true: "Vague", false: "Concrete" }, benign: "no" },
  pick: { type: "choice", instructions: "Which kind?", criteria: { a: "A", b: "B" }, benign: "a" },
  rate: { type: "score", instructions: "How clear?", criteria: ["low", "high"], benign: 1 },
};
const ANSWERS = {
  yn: { type: "noul", noul: 0.8 },
  pick: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 },
  rate: { type: "score", score: 1, probabilities: { 0: 0.1, 1: 0.9 }, confidence: 0.9 },
};

function mockFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return respond(); }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = () => new Response(JSON.stringify({ model: "jev-2026-10", answers: ANSWERS, usage: { input_tokens: 12, output_tokens: 3 } }), { status: 200 });

describe("typeSafeProvider", () => {
  it("POSTs state, model and the questions without `benign` to /v1/systemone with a bearer key", async () => {
    const { f, calls } = mockFetch(ok);
    const s1 = typeSafeProvider({ apiKey: KEY, fetch: f });
    expect(s1).toMatchObject({ mode: "http", model: DEFAULT_TYPESAFE_MODEL });
    const reply = await s1.ask({ a: 1 }, QUESTIONS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TYPESAFE_URL);
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      state: { a: 1 }, model: "jev-latest",
      questions: {
        yn: { type: "noul", instructions: "Is it vague?", criteria: { true: "Vague", false: "Concrete" } },
        pick: { type: "choice", instructions: "Which kind?", criteria: { a: "A", b: "B" } },
        rate: { type: "score", instructions: "How clear?", criteria: ["low", "high"] },
      },
    });
    expect(reply).toMatchObject({ provider: "typesafe", model: "jev-2026-10", answers: ANSWERS, usage: { input_tokens: 12, output_tokens: 3 } });
  });

  it("strips fake-provider directives from the state it sends", async () => {
    const { f, calls } = mockFetch(ok);
    await typeSafeProvider({ apiKey: KEY, fetch: f }).ask({ subject: { text: "Lists contacts. #s1no #s1pick:b #s1:yn=yes" }, list: ["#s1harm keep"] }, QUESTIONS);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(JSON.stringify(body.state)).not.toContain("#s1");
    expect(body.state).toEqual({ subject: { text: "Lists contacts.   " }, list: [" keep"] });
  });

  it("caches a reply and retries a 429", async () => {
    let n = 0;
    const { f, calls } = mockFetch(() => (++n === 1 ? new Response("busy", { status: 429 }) : ok()));
    const s1 = typeSafeProvider({ apiKey: KEY, fetch: f });
    await s1.ask({ a: 1 }, QUESTIONS, { backoffMs: 0 });
    await s1.ask({ a: 1 }, QUESTIONS, { backoffMs: 0 });
    expect(calls).toHaveLength(2);
  });

  it("fails with an S1Error on a malformed reply and never echoes the key", async () => {
    const { f } = mockFetch(() => new Response(JSON.stringify({ answers: [] }), { status: 200 }));
    const err = await typeSafeProvider({ apiKey: KEY, fetch: f }).ask({}, QUESTIONS).catch((e) => e);
    expect(err).toMatchObject({ name: "S1Error", code: "bad-response" });
    expect(String(err.message)).not.toContain(KEY);
    expect(() => typeSafeProvider({ apiKey: "" })).toThrow(/API key/);
  });
});

describe("providerFromEnv selection", () => {
  const never = (() => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
  const cases: [string, Record<string, string>, string, string][] = [
    ["fake beats every key", { FAKE_S1: "1", TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or" }, "fake", "fake"],
    ["TypeSafe beats OpenRouter", { TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or" }, "http", DEFAULT_TYPESAFE_MODEL],
    ["TypeSafe alone", { TYPESAFE_API_KEY: KEY }, "http", DEFAULT_TYPESAFE_MODEL],
    ["a blank TypeSafe key falls through to OpenRouter", { TYPESAFE_API_KEY: " ", OPENROUTER_API_KEY: "or" }, "http", DEFAULT_OPENROUTER_MODEL],
    ["OpenRouter alone", { OPENROUTER_API_KEY: "or" }, "http", DEFAULT_OPENROUTER_MODEL],
    ["nothing is off", {}, "off", "off"],
    ["FAKE_S1 other than 1 is not fake", { FAKE_S1: "true" }, "off", "off"],
  ];
  it.each(cases)("%s", (_, env, mode, model) => {
    expect(providerFromEnv({ ...env, fetch: never })).toMatchObject({ mode, model });
  });

  it("the TypeSafe pick talks to TypeSafe", async () => {
    const { f, calls } = mockFetch(ok);
    const reply = await providerFromEnv({ TYPESAFE_API_KEY: KEY, OPENROUTER_API_KEY: "or", fetch: f }).ask({}, QUESTIONS);
    expect(calls[0]!.url).toBe(TYPESAFE_URL);
    expect(reply.provider).toBe("typesafe");
  });
});
