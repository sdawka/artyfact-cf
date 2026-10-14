import { describe, expect, it } from "vitest";
import {
  askCacheKey, CLEF_MODEL, checkImages, fakeSystemOne, MAX_IMAGE_BYTES, openRouterProvider, providerFromEnv, S1Error, typeSafeProvider,
  visionProviderFromEnv, workersAiProvider, type AiBinding, type S1Image, type S1Questions,
} from "../../src/index.ts";

const QUESTIONS: S1Questions = {
  yn: { type: "noul", instructions: "Is it vague?", criteria: { true: "Vague", false: "Concrete" }, benign: "no" },
  pick: { type: "choice", instructions: "Which kind?", criteria: { a: "A", b: "B" }, benign: "a" },
  rate: { type: "score", instructions: "How clear?", criteria: ["low", "mid", "high"], benign: 2 },
};
// Clef's documented answer shapes (schema-output.json): noul probability, choice with probabilities and confidence,
// score as a probability-weighted level with a legend.
const ANSWERS = {
  yn: { type: "noul", noul: 0.12 },
  pick: { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.8 }, confidence: 0.7 },
  rate: { type: "score", score: 1.7, legend: { 0: "low", 1: "mid", 2: "high" }, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 }, confidence: 0.6 },
};

/** A mock `env.AI` recording each run. */
function mockAi(respond: (n: number) => unknown | Promise<unknown> = () => ({ model: "clef", answers: ANSWERS, usage: { input_tokens: 40, output_tokens: 0 } })) {
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  const ai: AiBinding = { run: async (model, inputs) => { calls.push({ model, inputs }); return respond(calls.length); } };
  return { ai, calls };
}

const png = (bytes = 8): S1Image => ({ mediaType: "image/png", base64: btoa("x".repeat(bytes)) });
const never = (() => { throw new Error("must not fetch"); }) as unknown as typeof fetch;

describe("providerFromEnv with Clef", () => {
  const { ai } = mockAi();

  it("orders FAKE_S1, TypeSafe, Clef (AI bound), OpenRouter, off", () => {
    expect(providerFromEnv({ FAKE_S1: "1", TYPESAFE_API_KEY: "ts-key", AI: ai, OPENROUTER_API_KEY: "or" }).mode).toBe("fake");
    expect(providerFromEnv({ TYPESAFE_API_KEY: "ts-key", AI: ai, OPENROUTER_API_KEY: "or" }).model).toBe("jev-latest");
    expect(providerFromEnv({ AI: ai, OPENROUTER_API_KEY: "or" })).toMatchObject({ mode: "http", model: CLEF_MODEL, images: true });
    expect(providerFromEnv({ OPENROUTER_API_KEY: "or" }).model).toBe("perplexity/pplx-decider-v1.1-27b");
    expect(providerFromEnv({}).mode).toBe("off");
  });

  it("CLEF_MODEL picks the model; a blank one keeps the default", () => {
    expect(providerFromEnv({ AI: ai, CLEF_MODEL: "@cf/cloudflare/clef-flash" }).model).toBe("@cf/cloudflare/clef-flash");
    expect(providerFromEnv({ AI: ai, CLEF_MODEL: "  " }).model).toBe(CLEF_MODEL);
  });

  it("an AI value without run() is not a binding", () => {
    expect(providerFromEnv({ AI: {} as AiBinding }).mode).toBe("off");
  });

  it("visionProviderFromEnv keeps an image-reading provider and falls back to Clef beside TypeSafe", () => {
    expect(visionProviderFromEnv({ FAKE_S1: "1", AI: ai }).mode).toBe("fake");
    expect(visionProviderFromEnv({ TYPESAFE_API_KEY: "ts-key", AI: ai })).toMatchObject({ model: CLEF_MODEL, images: true });
    expect(visionProviderFromEnv({ TYPESAFE_API_KEY: "ts-key" })).toMatchObject({ model: "jev-latest" });
    expect(visionProviderFromEnv({}).mode).toBe("off");
  });
});

describe("workersAiProvider", () => {
  it("runs @cf/cloudflare/clef with the System One body, directives and benign hints stripped", async () => {
    const { ai, calls } = mockAi();
    const reply = await workersAiProvider(ai).ask({ text: "Lists contacts. #s1no" }, QUESTIONS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("@cf/cloudflare/clef");
    expect(calls[0]!.inputs).toEqual({
      model: "clef",
      state: { text: "Lists contacts. " },
      questions: {
        yn: { type: "noul", instructions: "Is it vague?", criteria: { true: "Vague", false: "Concrete" } },
        pick: { type: "choice", instructions: "Which kind?", criteria: { a: "A", b: "B" } },
        rate: { type: "score", instructions: "How clear?", criteria: ["low", "mid", "high"] },
      },
    });
    expect(reply.provider).toBe("clef");
    expect(reply.model).toBe(CLEF_MODEL);
    expect(reply.usage).toEqual({ input_tokens: 40, output_tokens: 0 });
    expect(reply.answers.yn).toEqual({ type: "noul", noul: 0.12 });
    expect(reply.answers.pick).toMatchObject({ type: "choice", choice: "b", confidence: 0.7 });
    // A weighted score reads as its most probable level.
    expect(reply.answers.rate).toMatchObject({ type: "score", score: 2, confidence: 0.6 });
  });

  it("sends clef-flash's selector for the 9B model", async () => {
    const { ai, calls } = mockAi();
    await workersAiProvider(ai, "@cf/cloudflare/clef-flash").ask({}, { yn: QUESTIONS.yn! });
    expect(calls[0]).toMatchObject({ model: "@cf/cloudflare/clef-flash", inputs: { model: "clef-flash" } });
  });

  it("sends images as {content_type, base64} and keys the cache on them", async () => {
    const { ai, calls } = mockAi();
    const s1 = workersAiProvider(ai);
    const a: S1Image = { mediaType: "image/jpeg", base64: btoa("jpeg-bytes") };
    const b: S1Image = { mediaType: "image/webp", base64: btoa("webp-bytes") };
    await s1.ask({ claim: "x" }, { yn: QUESTIONS.yn! }, { images: [a] });
    expect(calls[0]!.inputs.images).toEqual([{ content_type: "image/jpeg", base64: a.base64 }]);
    await s1.ask({ claim: "x" }, { yn: QUESTIONS.yn! }, { images: [a] });
    expect(calls).toHaveLength(1);
    await s1.ask({ claim: "x" }, { yn: QUESTIONS.yn! }, { images: [b] });
    await s1.ask({ claim: "x" }, { yn: QUESTIONS.yn! });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.inputs).not.toHaveProperty("images");
  });

  it("retries a transient failure and fails fast on a rejected request", async () => {
    const flaky = mockAi((n) => { if (n === 1) throw new Error("3040: Capacity temporarily exceeded"); return { answers: ANSWERS, usage: {} }; });
    await expect(workersAiProvider(flaky.ai).ask({}, QUESTIONS, { backoffMs: 0 })).resolves.toMatchObject({ provider: "clef" });
    expect(flaky.calls).toHaveLength(2);
    const bad = mockAi(() => { throw new Error("400: invalid input: questions"); });
    await expect(workersAiProvider(bad.ai).ask({}, QUESTIONS, { backoffMs: 0 })).rejects.toMatchObject({ code: "http", status: 400 });
    expect(bad.calls).toHaveLength(1);
  });

  it("times out and rejects malformed answers as S1Errors", async () => {
    const slow = mockAi(() => new Promise(() => {}));
    await expect(workersAiProvider(slow.ai).ask({}, QUESTIONS, { timeoutMs: 5, retries: 0 })).rejects.toMatchObject({ code: "timeout" });
    const malformed = mockAi(() => ({ answers: { yn: { type: "noul", noul: 3 } } }));
    await expect(workersAiProvider(malformed.ai).ask({}, { yn: QUESTIONS.yn! })).rejects.toMatchObject({ code: "bad-response" });
    const empty = mockAi(() => null);
    await expect(workersAiProvider(empty.ai).ask({}, { yn: QUESTIONS.yn! })).rejects.toBeInstanceOf(S1Error);
  });
});

describe("image limits", () => {
  it("allows up to four PNG, JPEG or WebP images within 4 MiB each and 8 MiB in all", () => {
    expect(() => checkImages(undefined)).not.toThrow();
    expect(() => checkImages([png(), png(), png(), png()])).not.toThrow();
    expect(() => checkImages([png(), png(), png(), png(), png()])).toThrow(/at most 4 images/);
    expect(() => checkImages([{ mediaType: "image/gif" as "image/png", base64: btoa("g") }])).toThrow(/not PNG, JPEG or WebP/);
    expect(() => checkImages([{ mediaType: "image/png", base64: "not base64!" }])).toThrow(/not base64/);
    const big = { mediaType: "image/png" as const, base64: "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 3) * 4) / 3)) };
    expect(() => checkImages([big])).toThrow(/over the 4194304-byte limit/);
    const three = { mediaType: "image/png" as const, base64: "A".repeat(Math.floor(((3 * 1024 * 1024) * 4) / 3)) };
    expect(() => checkImages([three, three, three])).toThrow(/images total/);
  });

  it("Clef refuses images over the limits before calling the model", async () => {
    const { ai, calls } = mockAi();
    await expect(workersAiProvider(ai).ask({}, QUESTIONS, { images: [png(), png(), png(), png(), png()] })).rejects.toMatchObject({ code: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("providers that cannot read images refuse them instead of answering without them", async () => {
    const opts = { images: [png()] };
    await expect(typeSafeProvider({ apiKey: "ts-key", fetch: never }).ask({}, QUESTIONS, opts)).rejects.toMatchObject({ code: "unsupported" });
    await expect(openRouterProvider({ apiKey: "or-key", fetch: never }).ask({}, QUESTIONS, opts)).rejects.toMatchObject({ code: "unsupported" });
    await expect(fakeSystemOne().ask({}, QUESTIONS, opts)).resolves.toMatchObject({ provider: "fake" });
  });

  it("the cache key carries an image hash", () => {
    const plain = askCacheKey({ a: 1 }, QUESTIONS, "m");
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [] })).toBe(plain);
    const one = askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [png(8)] });
    expect(one).not.toBe(plain);
    expect(one.startsWith(plain)).toBe(true);
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [png(9)] })).not.toBe(one);
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { cacheKey: "k", images: [png(8)] })).toMatch(/^k:img:/);
  });
});
