import { limiter, lruCache, withRetries } from "./http.ts";
import { readDecision } from "./openrouter.ts";
import { askCacheKey, checkImages, S1Error, stripDirectives, wireQuestions } from "./provider.ts";
import type { Answer, AskOptions, S1Questions, S1Reply, SystemOne } from "./types.ts";

/** Cloudflare Clef on Workers AI: open-weight decision models speaking the System One wire format. */
export const CLEF_MODEL = "@cf/cloudflare/clef";
export const CLEF_FLASH_MODEL = "@cf/cloudflare/clef-flash";

/** The slice of the Workers AI binding this provider uses, typed structurally so packages need no Worker types. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface WorkersAiOptions {
  cacheSize?: number;
  /** Calls in flight at once; default 4. */
  concurrency?: number;
}

interface ClefBody { model?: unknown; answers?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } }

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** The request's `model` selector: the id's last segment (`clef`, `clef-flash`). */
const selectorOf = (model: string) => model.split("/").pop() || "clef";
/** Errors Workers AI raises for a request it will never accept; anything else (capacity, upstream, network) is retried. */
const REJECTED = /\b(400|401|403|404|413|422)\b|invalid|schema|too large|not found|unknown model/i;

/**
 * Clef through the Workers AI binding as a `SystemOne`. Same contract as the HTTP providers: directives stripped,
 * `benign` stripped, LRU cache keyed on state, questions, model and image hashes, retries with backoff on timeouts
 * and transient failures, every failure an `S1Error`. Images (at most 4, PNG/JPEG/WebP, 4 MiB each, 8 MiB total) go
 * as `{content_type, base64}` entries of `images`, which Clef places before the state.
 */
export function workersAiProvider(ai: AiBinding, model: string = CLEF_MODEL, o: WorkersAiOptions = {}): SystemOne {
  const cache = lruCache<S1Reply>(o.cacheSize ?? 200);
  const run = limiter(o.concurrency ?? 4);

  async function attempt(state: unknown, questions: S1Questions, opts: AskOptions, timeoutMs: number): Promise<Omit<S1Reply, "ms">> {
    const body: Record<string, unknown> = { model: selectorOf(model), state: stripDirectives(state), questions: wireQuestions(questions) };
    if (opts.images?.length) body.images = opts.images.map((i) => ({ content_type: i.mediaType, base64: i.base64 }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown;
    try {
      raw = await Promise.race([
        ai.run(model, body),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new S1Error(`Clef timed out after ${timeoutMs} ms`, "timeout")), timeoutMs); }),
      ]);
    } catch (e) {
      if (e instanceof S1Error) throw e;
      const message = `Clef: ${(e as Error)?.message ?? String(e)}`.slice(0, 300);
      throw new S1Error(message, "http", REJECTED.test(message) ? 400 : 503);
    } finally {
      clearTimeout(timer);
    }
    const res = raw as ClefBody | null;
    if (!res || !res.answers || typeof res.answers !== "object" || Array.isArray(res.answers)) throw new S1Error("Clef: malformed response", "bad-response");
    const wire = res.answers as Record<string, unknown>;
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(questions)) {
      const a = readDecision(q.type, wire[id]);
      if (!a) throw new S1Error(`Clef: malformed ${q.type} answer for ${id}`, "bad-response");
      answers[id] = a;
    }
    const usage = { input_tokens: num(res.usage?.input_tokens) ? res.usage.input_tokens : 0, output_tokens: num(res.usage?.output_tokens) ? res.usage.output_tokens : 0 };
    // The reply names the Workers AI model id, not the bare selector Clef echoes back.
    return { answers, model, usage, provider: "clef" };
  }

  async function ask(state: unknown, questions: S1Questions, opts: AskOptions = {}): Promise<S1Reply> {
    checkImages(opts.images);
    const key = askCacheKey(state, questions, model, opts);
    const hit = cache.get(key);
    if (hit) return hit;
    // Images take longer to encode than text; give them a longer default.
    const { timeoutMs = opts.images?.length ? 30_000 : 5_000, retries = 2, backoffMs = 250 } = opts;
    return run(async () => {
      const t0 = Date.now();
      const reply: S1Reply = { ...(await withRetries(() => attempt(state, questions, opts, timeoutMs), { retries, backoffMs })), ms: Date.now() - t0 };
      cache.set(key, reply);
      return reply;
    });
  }

  return { mode: "http", model, images: true, ask };
}
