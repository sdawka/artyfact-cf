import { describe, expect, it } from "vitest";
import {
  askCacheKey, base64Bytes, CLEF_MODEL, checkImages, DEFAULT_TYPESAFE_MODEL, fakeSystemOne, JEV_OPENROUTER_MODEL, MAX_IMAGE_BYTES, simulatedSystemOne, openRouterProvider, providerFromEnv, S1Error, typeSafeProvider,
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

/** Real base64 of exactly `n` decoded bytes. */
const sized = (n: number): S1Image => ({ mediaType: "image/png", base64: Buffer.alloc(n).toString("base64") });
const plainKey = () => askCacheKey({ a: 1 }, QUESTIONS, "m");
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

describe("S1_PROVIDER", () => {
  const { ai } = mockAi();
  const all = { TYPESAFE_API_KEY: "ts-key", AI: ai, OPENROUTER_API_KEY: "or", fetch: never };

  it("auto (or unset, any case) keeps the precedence order", () => {
    expect(providerFromEnv({ ...all, S1_PROVIDER: "auto" }).model).toBe("jev-latest");
    expect(providerFromEnv({ ...all, S1_PROVIDER: " AUTO " }).model).toBe("jev-latest");
    expect(providerFromEnv({ AI: ai, S1_PROVIDER: "" }).model).toBe(CLEF_MODEL);
  });

  it("picks the named provider over the precedence order", () => {
    expect(providerFromEnv({ ...all, S1_PROVIDER: "clef" })).toMatchObject({ model: CLEF_MODEL, images: true });
    expect(providerFromEnv({ ...all, S1_PROVIDER: "clef", CLEF_MODEL: "@cf/cloudflare/clef-flash" }).model).toBe("@cf/cloudflare/clef-flash");
    expect(providerFromEnv({ ...all, S1_PROVIDER: "openrouter" }).model).toBe("perplexity/pplx-decider-v1.1-27b");
    expect(providerFromEnv({ ...all, S1_PROVIDER: "fake" }).mode).toBe("fake");
    expect(providerFromEnv({ ...all, S1_PROVIDER: "off" })).toMatchObject({ mode: "off", reason: "S1_PROVIDER=off" });
    expect(providerFromEnv({ ...all, S1_PROVIDER: "fake", FAKE_S1: "1" }).mode).toBe("fake");
  });

  it("jev is TypeSafe with a TypeSafe key, else Jev on OpenRouter, with JEV_MODEL overriding either", () => {
    expect(providerFromEnv({ ...all, S1_PROVIDER: "jev" }).model).toBe(DEFAULT_TYPESAFE_MODEL);
    expect(providerFromEnv({ ...all, S1_PROVIDER: "jev", JEV_MODEL: "jev-1.13.0" }).model).toBe("jev-1.13.0");
    expect(providerFromEnv({ OPENROUTER_API_KEY: "or", S1_PROVIDER: "jev" }).model).toBe(JEV_OPENROUTER_MODEL);
    expect(JEV_OPENROUTER_MODEL).toBe("typesafe/jev-1.13");
    expect(providerFromEnv({ OPENROUTER_API_KEY: "or", S1_PROVIDER: "jev", JEV_MODEL: "jev-latest" }).model).toBe("typesafe/jev-latest");
    expect(providerFromEnv({ OPENROUTER_API_KEY: "or", S1_PROVIDER: "jev", JEV_MODEL: "~typesafe/jev-latest" }).model).toBe("~typesafe/jev-latest");
  });

  it("an explicit provider without its key or binding is off with the reason, never another provider", async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["clef", { TYPESAFE_API_KEY: "ts-key", OPENROUTER_API_KEY: "or" }, /needs the Workers AI binding AI/],
      ["jev", { AI: ai }, /needs TYPESAFE_API_KEY or OPENROUTER_API_KEY/],
      ["openrouter", { TYPESAFE_API_KEY: "ts-key", AI: ai }, /needs OPENROUTER_API_KEY/],
      ["clfe", all, /S1_PROVIDER=clfe is not one of auto, clef, jev, openrouter, fake, off/],
    ];
    for (const [name, env, reason] of cases) {
      const s1 = providerFromEnv({ ...env, S1_PROVIDER: name });
      expect(s1.mode, name).toBe("off");
      expect(s1.reason, name).toMatch(reason);
      await expect(s1.ask({}, QUESTIONS)).rejects.toThrow(reason);
    }
  });

  it("visual checks: Clef beside Jev or OpenRouter when AI is bound; an explicit off stays off", () => {
    expect(visionProviderFromEnv({ ...all, S1_PROVIDER: "jev" })).toMatchObject({ model: CLEF_MODEL, images: true });
    expect(visionProviderFromEnv({ OPENROUTER_API_KEY: "or", S1_PROVIDER: "jev" })).toMatchObject({ model: JEV_OPENROUTER_MODEL });
    expect(visionProviderFromEnv({ ...all, S1_PROVIDER: "openrouter" })).toMatchObject({ model: CLEF_MODEL });
    expect(visionProviderFromEnv({ ...all, S1_PROVIDER: "off" }).mode).toBe("off");
    expect(visionProviderFromEnv({ TYPESAFE_API_KEY: "ts-key", S1_PROVIDER: "clef" })).toMatchObject({ mode: "off", reason: expect.stringMatching(/AI/) });
  });

  it("the simulated provider is the fake recorded as simulated", async () => {
    const r = await simulatedSystemOne().ask({}, QUESTIONS);
    expect(r).toMatchObject({ provider: "simulated", model: "simulated" });
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
    expect(() => checkImages([sized(MAX_IMAGE_BYTES)])).not.toThrow();
    expect(() => checkImages([sized(MAX_IMAGE_BYTES + 1)])).toThrow(/4194305 bytes is over the 4194304-byte limit/);
    const three = sized(3 * 1024 * 1024);
    expect(() => checkImages([three, three])).not.toThrow();
    expect(() => checkImages([three, three, three])).toThrow(/images total 9437184 bytes/);
  });

  it("measures decoded bytes exactly and refuses non-canonical base64 rather than guessing its size", () => {
    for (const n of [1, 2, 3, 4, 5, 1000, 1001, 1002]) expect(base64Bytes(Buffer.alloc(n).toString("base64"))).toBe(n);
    // Unpadded or whitespace-split base64 is refused, so no length trick can understate the size.
    expect([base64Bytes("QQ=="), base64Bytes("QUI="), base64Bytes("QUJD")]).toEqual([1, 2, 3]);
    const ok = Buffer.alloc(9).toString("base64");
    for (const bad of ["QUJD\nREVG", "QUJDRA", "QUJDRA=", "====", "", ` ${ok}`, `${ok}\n`, "QUJD\tREVG", "QUJD REVG", `data:image/png;base64,${ok}`, "QQ==QUJD", "QUJD===="]) {
      expect(() => checkImages([{ mediaType: "image/png", base64: bad }]), bad).toThrow(/not base64/);
    }
  });

  it("Clef refuses images over the limits before calling the model", async () => {
    const { ai, calls } = mockAi();
    await expect(workersAiProvider(ai).ask({}, QUESTIONS, { images: [png(), png(), png(), png(), png()] })).rejects.toMatchObject({ code: "invalid" });
    expect(calls).toHaveLength(0);
    // Sizes are decoded bytes, whatever size or digest the caller claims.
    await expect(workersAiProvider(ai).ask({}, QUESTIONS, { images: [{ ...sized(MAX_IMAGE_BYTES + 1), sha256: "small" }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(workersAiProvider(ai).ask({}, QUESTIONS, { images: [sized(3 << 20), sized(3 << 20), sized(3 << 20)] })).rejects.toMatchObject({ code: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("Clef checks images before the cache, so a cached answer never stands in for a refused ask", async () => {
    const { ai, calls } = mockAi();
    const s1 = workersAiProvider(ai);
    await s1.ask({ c: 1 }, QUESTIONS, { images: [png()] });
    await s1.ask({ c: 1 }, QUESTIONS, { images: [png()] });
    expect(calls).toHaveLength(1);
    for (const images of [[png(), png(), png(), png(), png()], [{ ...png(), base64: ` ${png().base64}` }], [{ ...sized(MAX_IMAGE_BYTES + 1), sha256: "x" }]]) {
      await expect(s1.ask({ c: 1 }, QUESTIONS, { images })).rejects.toMatchObject({ code: "invalid" });
      await expect(s1.ask({ c: 1 }, QUESTIONS, { images })).rejects.toMatchObject({ code: "invalid" });
    }
    expect(calls).toHaveLength(1);
  });

  it("providers that cannot read images refuse them instead of answering without them", async () => {
    const opts = { images: [png()] };
    await expect(typeSafeProvider({ apiKey: "ts-key", fetch: never }).ask({}, QUESTIONS, opts)).rejects.toMatchObject({ code: "unsupported" });
    await expect(openRouterProvider({ apiKey: "or-key", fetch: never }).ask({}, QUESTIONS, opts)).rejects.toMatchObject({ code: "unsupported" });
    await expect(fakeSystemOne().ask({}, QUESTIONS, opts)).resolves.toMatchObject({ provider: "fake" });
  });

  it("the cache key covers model, full state, questions and image bytes", () => {
    const plain = askCacheKey({ a: 1 }, QUESTIONS, "m");
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [] })).toBe(plain);
    const one = askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [png(8)] });
    expect(new Set([
      plain, one,
      askCacheKey({ a: 1 }, QUESTIONS, "m2", { images: [png(8)] }),
      askCacheKey({ a: 2 }, QUESTIONS, "m", { images: [png(8)] }),
      askCacheKey({ a: 1 }, { yn: QUESTIONS.yn! }, "m", { images: [png(8)] }),
      // Same size, different bytes; same bytes, different type.
      askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [{ mediaType: "image/png", base64: btoa("y".repeat(8)) }] }),
      askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [{ ...png(8), mediaType: "image/jpeg" }] }),
      askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [png(8), png(8)] }),
    ]).size).toBe(8);
  });

  it("a caller cannot alias another ask through a claimed sha256 or a cacheKey", () => {
    const real = askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [png(8)] });
    // A different image claiming the first one's digest still keys on its own bytes.
    const liar = { mediaType: "image/png" as const, base64: btoa("evil-bytes"), sha256: "same-digest" };
    const honest = { ...png(8), sha256: "same-digest" };
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [liar] })).not.toBe(askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [honest] }));
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { images: [honest] })).toBe(real);
    // An explicit cacheKey scopes, it never stands in for the state.
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { cacheKey: "k" })).not.toBe(askCacheKey({ a: 2 }, QUESTIONS, "m", { cacheKey: "k" }));
    expect(askCacheKey({ a: 1 }, QUESTIONS, "m", { cacheKey: plainKey() })).not.toBe(askCacheKey({ a: 1 }, QUESTIONS, "m"));
  });

  it("Clef does not serve one image's answer for another", async () => {
    let n = 0;
    const { ai, calls } = mockAi(() => ({ answers: { yn: { type: "noul", noul: ++n === 1 ? 0.95 : 0.05 } }, usage: {} }));
    const s1 = workersAiProvider(ai);
    const good = await s1.ask({ c: 1 }, { yn: QUESTIONS.yn! }, { images: [{ ...png(8), sha256: "x" }] });
    const bad = await s1.ask({ c: 1 }, { yn: QUESTIONS.yn! }, { images: [{ mediaType: "image/png", base64: btoa("other!!!"), sha256: "x" }] });
    expect(calls).toHaveLength(2);
    expect([good.answers.yn, bad.answers.yn]).toEqual([{ type: "noul", noul: 0.95 }, { type: "noul", noul: 0.05 }]);
  });
});
