import { hashOf } from "../canon.ts";
import { fakeAnswers } from "./fake.ts";
import { lruCache } from "./http.ts";
import type { AskOptions, S1Image, S1Questions, S1Reply, SystemOne } from "./types.ts";

/** `unsupported`: the provider cannot do what was asked (images); `invalid`: the request breaks a documented limit. */
export type S1ErrorCode = "off" | "timeout" | "http" | "network" | "bad-response" | "unsupported" | "invalid";

export class S1Error extends Error {
  readonly code: S1ErrorCode;
  readonly status?: number;
  constructor(message: string, code: S1ErrorCode, status?: number) {
    super(message);
    this.name = "S1Error";
    this.code = code;
    this.status = status;
  }
}

interface WireResponse { model?: string; answers: S1Reply["answers"]; usage?: S1Reply["usage"] }

const ZERO = { input_tokens: 0, output_tokens: 0 };

export const cacheKeyFor = (state: unknown, questions: S1Questions, model: string): string => hashOf({ state, questions, model });

/** Clef's image limits: at most 4 images, each at most 4 MiB, at most 8 MiB together (decoded bytes). */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Decoded size of canonical base64 (`checkImages` admits only that: alphabet, padding, length a multiple of 4), which
 * is exact without decoding: 3 bytes per 4 characters, less the padding.
 */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isCanonicalBase64 = (s: string) => s.length > 0 && s.length % 4 === 0 && BASE64.test(s);

/** Throws an `invalid` S1Error when `images` breaks a limit: count, type, base64 form, per-image or total size. */
export function checkImages(images: readonly S1Image[] | undefined): void {
  if (!images?.length) return;
  if (images.length > MAX_IMAGES) throw new S1Error(`at most ${MAX_IMAGES} images per ask (got ${images.length})`, "invalid");
  let total = 0;
  images.forEach((img, i) => {
    if (!(IMAGE_TYPES as readonly string[]).includes(img.mediaType)) throw new S1Error(`image ${i + 1}: type ${String(img.mediaType).slice(0, 40)} is not PNG, JPEG or WebP`, "invalid");
    if (typeof img.base64 !== "string" || !isCanonicalBase64(img.base64)) throw new S1Error(`image ${i + 1}: not base64`, "invalid");
    const bytes = base64Bytes(img.base64);
    if (bytes > MAX_IMAGE_BYTES) throw new S1Error(`image ${i + 1}: ${bytes} bytes is over the ${MAX_IMAGE_BYTES}-byte limit`, "invalid");
    total += bytes;
  });
  if (total > MAX_TOTAL_IMAGE_BYTES) throw new S1Error(`images total ${total} bytes, over the ${MAX_TOTAL_IMAGE_BYTES}-byte limit`, "invalid");
}

/**
 * The cache key of an ask: a hash over everything that can change the answer, namely the model, the full state, the
 * questions and each image's type and bytes. The image hash is computed here from the base64; a caller's `sha256` is
 * never trusted, so a wrong one cannot alias another image. `opts.cacheKey` only adds a scope and never replaces
 * state, so no caller can pick a key that collides with another caller's ask. Keys are hashes of canonical JSON, so
 * field boundaries cannot be forged by string content.
 */
export function askCacheKey(state: unknown, questions: S1Questions, model: string, opts: AskOptions = {}): string {
  const base = cacheKeyFor(state, questions, model);
  if (opts.cacheKey === undefined && !opts.images?.length) return base;
  return hashOf({ base, scope: opts.cacheKey ?? null, images: (opts.images ?? []).map((i) => [i.mediaType, hashOf(i.base64)]) });
}

/** The refusal of a provider that cannot read images: an S1Error, so judgments record it as an unknown, never a pass. */
export const refuseImages = (provider: string, opts?: AskOptions): void => {
  if (opts?.images?.length) throw new S1Error(`${provider} cannot read images; visual judgments need Clef (Workers AI binding AI)`, "unsupported");
};

/** Strips the fake provider's `benign` hint before a question goes on the wire. */
export const wireQuestions = (questions: S1Questions): S1Questions =>
  Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const { benign: _benign, ...wire } = q;
    return [id, wire as S1Questions[string]];
  }));

/** A fake-provider directive (`#s1no`, `#s1pick:<key>`, `#s1:<id>=<answer>`, ...) anywhere in a string. */
const DIRECTIVE = /#s1[\w.:|=-]*/g;

/**
 * The state with every fake-provider directive removed from its strings. Real providers send this, so Genome text
 * cannot carry instructions meant for the fake (which only `FAKE_S1=1` selects) to a real model.
 */
export function stripDirectives(state: unknown): unknown {
  if (typeof state === "string") return state.replace(DIRECTIVE, "");
  if (Array.isArray(state)) return state.map(stripDirectives);
  if (state && typeof state === "object") return Object.fromEntries(Object.entries(state).map(([k, v]) => [k, stripDirectives(v)]));
  return state;
}

/** The fake accepts images within the limits (so the visual path is testable) and answers from the state alone. */
export const fakeSystemOne = (model = "fake"): SystemOne => ({
  mode: "fake",
  model,
  images: true,
  ask: async (state, questions, opts) => {
    checkImages(opts?.images);
    return { answers: fakeAnswers(state, questions), model, ms: 0, usage: ZERO, provider: "fake" };
  },
});

export const offSystemOne = (): SystemOne => ({
  mode: "off",
  model: "off",
  ask: async () => { throw new S1Error("System One is off", "off"); },
});

export interface HttpOptions {
  url: string;
  model: string;
  apiKey?: string;
  /** Name recorded as the reply's provider. */
  provider?: string;
  fetch?: typeof fetch;
  cacheSize?: number;
}

/** POSTs `{state, model, questions}` and expects `{model, answers, usage}`; retries timeouts, 429 and 529; LRU-caches replies. */
export function httpSystemOne(o: HttpOptions): SystemOne {
  const cache = lruCache<S1Reply>(o.cacheSize ?? 200);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function attempt(state: unknown, questions: S1Questions, timeoutMs: number): Promise<WireResponse> {
    const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(o.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(o.apiKey && { Authorization: `Bearer ${o.apiKey}` }) },
        body: JSON.stringify({ state: stripDirectives(state), model: o.model, questions: wireQuestions(questions) }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new S1Error(`System One HTTP ${res.status}`, "http", res.status);
      const body = (await res.json()) as WireResponse;
      if (!body || typeof body.answers !== "object" || body.answers === null || Array.isArray(body.answers)) {
        throw new S1Error("System One: malformed response", "bad-response");
      }
      return body;
    } catch (e) {
      if (e instanceof S1Error) throw e;
      if (ctl.signal.aborted) throw new S1Error(`System One timed out after ${timeoutMs} ms`, "timeout");
      throw new S1Error(`System One network error: ${(e as Error)?.message ?? e}`, "network");
    } finally {
      clearTimeout(timer);
    }
  }

  const retryable = (e: S1Error) => e.code === "timeout" || (e.code === "http" && (e.status === 429 || e.status === 529));

  async function ask(state: unknown, questions: S1Questions, opts: AskOptions = {}): Promise<S1Reply> {
    refuseImages(o.provider ?? "This System One provider", opts);
    const t0 = Date.now();
    const key = askCacheKey(state, questions, o.model, opts);
    const hit = cache.get(key);
    if (hit) return hit;
    const { timeoutMs = 2500, retries = 1, backoffMs = 200 } = opts;
    for (let n = 0; ; n++) {
      try {
        const body = await attempt(state, questions, timeoutMs);
        const reply: S1Reply = { answers: body.answers, model: body.model ?? o.model, ms: Date.now() - t0, usage: body.usage ?? ZERO, provider: o.provider ?? "http" };
        cache.set(key, reply);
        return reply;
      } catch (e) {
        if (!(e instanceof S1Error) || !retryable(e) || n >= retries) throw e;
        await sleep(backoffMs);
      }
    }
  }

  return { mode: "http", model: o.model, ask };
}

/** TypeSafe System One (Jev). */
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_TYPESAFE_MODEL = "jev-latest";

export interface TypeSafeOptions { apiKey: string; model?: string; url?: string; fetch?: typeof fetch; cacheSize?: number }

/** TypeSafe speaks the engine's wire format (`{state, model, questions}` in, `{model, answers, usage}` out) with a bearer key. */
export function typeSafeProvider(o: TypeSafeOptions): SystemOne {
  if (!o.apiKey) throw new S1Error("TypeSafe needs an API key", "off");
  return httpSystemOne({
    url: o.url ?? TYPESAFE_URL, model: o.model || DEFAULT_TYPESAFE_MODEL, apiKey: o.apiKey, provider: "typesafe", fetch: o.fetch, cacheSize: o.cacheSize,
  });
}
