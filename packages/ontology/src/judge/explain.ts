import { hashOf } from "../canon.ts";
import { failWith, limiter, lruCache, openRouterHeaders, postJson, redactor, withRetries } from "./http.ts";
import { S1Error } from "./provider.ts";
import type { SliceState } from "./slice.ts";
import type { AskOptions, S1Mode, Usage } from "./types.ts";

/**
 * An explanation is advisory prose about one confirmed finding. It is never read for level or status, and an
 * explainer never throws: a failure comes back as `{ provider: "error", error }`.
 */
export interface Explanation {
  text?: string;
  model: string;
  provider: string;
  usage?: Usage;
  error?: string;
}

export interface ExplainRequest {
  /** The defect class of the finding, e.g. `contradiction`. */
  defect: string;
  /** The question the judge asked. */
  question: string;
  /** The confident answer it got. */
  answer: string;
  /** Node ids the finding is about. */
  subjects: string[];
}

export interface Explainer {
  mode: S1Mode;
  model: string;
  explain(state: SliceState, req: ExplainRequest, opts?: AskOptions): Promise<Explanation>;
}

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Listed by `GET https://openrouter.ai/api/v1/models` on 2026-10-13 at $0.10/M input and $0.50/M output tokens. */
export const DEFAULT_EXPLAIN_MODEL = "openai/gpt-6-luna";

export const EXPLAIN_SYSTEM_PROMPT =
  "You read a slice of a specification graph and one confirmed finding. In at most three sentences say which statements " +
  "are inconsistent and why, quoting node ids. Do not propose fixes. If you do not see the inconsistency, say so.";

export interface OpenRouterExplainerOptions {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
  cacheSize?: number;
  /** Requests in flight at once. Default 2. */
  concurrency?: number;
  maxTokens?: number;
  /** Per-attempt timeout unless `opts.timeoutMs` overrides it. Default 10000. */
  timeoutMs?: number;
  /** Sent as `X-Title`. */
  title?: string;
}

interface ChatBody {
  model?: string;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number | string; message?: string };
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export const explainCacheKey = (state: SliceState, req: ExplainRequest, model: string): string => hashOf({ state, req, model });

/**
 * OpenRouter chat completions as an `Explainer`. Key handling matches `openRouterProvider`: the key is used only in
 * the `Authorization` header and redacted from every error message. Successful explanations are LRU-cached.
 */
export function openRouterExplainer(o: OpenRouterExplainerOptions): Explainer {
  if (!o.apiKey) throw new S1Error("OpenRouter needs an API key", "off");
  const key = o.apiKey;
  const model = o.model || DEFAULT_EXPLAIN_MODEL;
  const url = o.url ?? OPENROUTER_CHAT_URL;
  const maxTokens = o.maxTokens ?? 200;
  const cache = lruCache<Explanation>(o.cacheSize ?? 200);
  const run = limiter(o.concurrency ?? 2);
  const redact = redactor(key);
  const fail = failWith(redact);

  const attempt = (state: SliceState, req: ExplainRequest, timeoutMs: number): Promise<Explanation> =>
    postJson<ChatBody, Explanation>({
      url, fetch: o.fetch, timeoutMs, label: "OpenRouter", redact,
      headers: openRouterHeaders(key, o.title),
      body: {
        model,
        messages: [
          { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ finding: req, state }) },
        ],
        max_tokens: maxTokens,
        temperature: 0,
      },
    }, ({ res, body }) => {
      if (!res.ok || body?.error) {
        const status = res.ok ? Number(body?.error?.code) || 502 : res.status;
        throw fail(`OpenRouter HTTP ${status}${body?.error?.message ? `: ${body.error.message}` : ""}`, "http", status);
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw fail("OpenRouter: malformed chat response", "bad-response");
      const u = body!.usage;
      return {
        text: content.trim(),
        model: typeof body!.model === "string" ? body!.model : model,
        provider: "openrouter",
        usage: { input_tokens: num(u?.prompt_tokens) ? u.prompt_tokens : 0, output_tokens: num(u?.completion_tokens) ? u.completion_tokens : 0 },
      };
    });

  async function explain(state: SliceState, req: ExplainRequest, opts: AskOptions = {}): Promise<Explanation> {
    const cacheKey = opts.cacheKey ?? explainCacheKey(state, req, model);
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const { timeoutMs = o.timeoutMs ?? 10_000, retries = 2, backoffMs = 250 } = opts;
    try {
      return await run(async () => {
        const out = await withRetries(() => attempt(state, req, timeoutMs), { retries, backoffMs });
        cache.set(cacheKey, out);
        return out;
      });
    } catch (e) {
      const message = e instanceof S1Error ? e.message : String((e as Error)?.message ?? e);
      return { model, provider: "error", error: redact(message).slice(0, 300) };
    }
  }

  return { mode: "http", model, explain };
}

export const fakeExplainer = (): Explainer => ({
  mode: "fake",
  model: "fake",
  explain: async (_state, req) => ({ text: `[fake] ${req.defect} on ${req.subjects.join(" and ")}`, model: "fake", provider: "fake" }),
});

export const offExplainer = (): Explainer => ({
  mode: "off",
  model: "off",
  explain: async () => ({ model: "off", provider: "off" }),
});

export interface ExplainerEnv {
  FAKE_S1?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_EXPLAIN_MODEL?: string;
  EXPLAIN?: string;
  fetch?: typeof fetch;
}

/** `EXPLAIN=0` turns explanations off; then `FAKE_S1=1` gives the fake; then `OPENROUTER_API_KEY` gives OpenRouter; else off. */
export function explainerFromEnv(env: ExplainerEnv): Explainer {
  if (env.EXPLAIN === "0") return offExplainer();
  if (env.FAKE_S1 === "1") return fakeExplainer();
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (apiKey) return openRouterExplainer({ apiKey, model: env.OPENROUTER_EXPLAIN_MODEL?.trim() || undefined, fetch: env.fetch });
  return offExplainer();
}
