import { z } from "zod";
import { hashOf } from "../canon.ts";
import { OPENROUTER_CHAT_URL } from "../judge/explain.ts";
import { failWith, limiter, lruCache, openRouterHeaders, postJson, redactor, withRetries } from "../judge/http.ts";
import { S1Error } from "../judge/provider.ts";
import type { AskOptions } from "../judge/types.ts";
import type { Op, TranslateInput, Translation, Translator } from "./types.ts";

/** Listed by OpenRouter on 2026-10-13 at $0.10/M input and $0.50/M output tokens; the explainer's default too. */
export const DEFAULT_TRANSLATE_MODEL = "openai/gpt-6-luna";

export const TRANSLATE_SYSTEM_PROMPT = [
  "You turn a user's message about a specification graph into edit operations.",
  "You get the message, the route a classifier chose (intent, space, kind, target node ids and the questions it asked),",
  "a slice of the graph around the targets, and the legal kinds and relations near them.",
  "Reply with exactly one JSON object and nothing else:",
  '{"ops":[...]} to edit the graph; {"question":"..."} when the message is unclear or you are not sure which item it means;',
  '{"answer":"..."} when the user only asks for information. Ask a question instead of guessing when the target is unclear.',
  "Op shapes:",
  '{"op":"add","kind":K,"parent"?:ID,"title":T,"description"?:D,"fields"?:{F:V,...},"criteria"?:[C,...],"links"?:[{"rel":R,"to":ID} or {"rel":R,"from":ID}]}',
  '{"op":"update","id":ID,"fields"?:{"title"?:T,"description"?:D,F:V,...},"criteria"?:[C or {"id":CID,"remove":true},...],"files"?:[GLOB,...] or null}',
  '{"op":"remove","id":ID}',
  '{"op":"link","from":ID,"rel":R,"to":ID} and {"op":"unlink","from":ID,"rel":R,"to":ID}',
  "fields are the kind's declared fields; a null value in an update deletes the field. A criterion C is what must hold",
  'for that node: {"id":"C.<name>","claim":TEXT,"severity"?:"hard"|"soft"|"advisory","target"?:"model"|"artifact"|"runtime"|"observation"};',
  "an update with an existing criterion id replaces it, and {\"id\":CID,\"remove\":true} deletes one the node declares.",
  "files are repo-relative globs (relative to the Thing's root) naming the source files that realise the node; set them when the user binds a node to code or folders.",
  "Use only node ids from the slice, kinds and relations from the vocabulary, and relation directions as declared.",
  "Make the smallest set of edits that carries out the message; keep titles short; do not add what already exists.",
].join("\n");

const id = z.string().min(1);
const fields = z.record(z.string(), z.unknown());
// Criteria are checked in full by `validateOps`, so a reply with a malformed criterion still parses and is reported.
const criterion = z.object({ id }).passthrough();
const OpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"), kind: id, parent: id.optional(), title: id, description: z.string().optional(),
    fields: fields.optional(), criteria: z.array(criterion).optional(),
    links: z.array(z.object({ rel: id, to: id.optional(), from: id.optional() }).refine((l) => !!l.to !== !!l.from, "a link names exactly one of to/from")).optional(),
  }),
  z.object({ op: z.literal("update"), id, fields: fields.optional(), criteria: z.array(criterion).optional(), files: z.array(z.string()).nullable().optional() }),
  z.object({ op: z.literal("remove"), id }),
  z.object({ op: z.enum(["link", "unlink"]), from: id, rel: id, to: id }),
]);
export const TranslationReplySchema = z.object({
  ops: z.array(OpSchema).optional(),
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
}).refine((r) => r.ops !== undefined || r.question !== undefined || r.answer !== undefined, "expected ops, question or answer");

/** Parses a model reply: one JSON object, optionally inside a single code fence; anything else is an error. */
export function parseTranslation(text: string): { ops?: Op[]; question?: string; answer?: string } | { error: string } {
  const body = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1").trim();
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { error: "translator reply is not JSON" }; }
  const r = TranslationReplySchema.safeParse(json);
  if (!r.success) return { error: `translator reply does not fit the schema: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 200)}` };
  return r.data as { ops?: Op[]; question?: string; answer?: string };
}

/** The user message the translator gets: the route without provenance, the slice and the vocabulary. */
export const translatePayload = (input: TranslateInput) => ({
  message: input.message,
  route: {
    intent: input.route.intent, status: input.route.status, target: input.route.target,
    path: input.route.path.map((s) => ({ level: s.level, answer: s.answer, confidence: s.confidence })),
  },
  slice: input.slice,
  ...(input.vocabulary && { vocabulary: input.vocabulary }),
});

export const translateCacheKey = (input: TranslateInput, model: string): string => hashOf({ input: translatePayload(input), model });

export interface OpenRouterTranslatorOptions {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
  cacheSize?: number;
  /** Requests in flight at once. Default 2. */
  concurrency?: number;
  maxTokens?: number;
  /** Per-attempt timeout unless `opts.timeoutMs` overrides it. Default 30000. */
  timeoutMs?: number;
  title?: string;
}

interface ChatBody {
  model?: string;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number | string; message?: string };
}
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * OpenRouter chat completions as a `Translator`. The key is used only in `Authorization` and redacted from errors;
 * a translator never throws: HTTP failures and replies that do not parse come back as `{ provider: "error", error }`
 * (with `raw` when there was a reply). Successful translations are LRU-cached.
 */
export function openRouterTranslator(o: OpenRouterTranslatorOptions): Translator {
  if (!o.apiKey) throw new S1Error("OpenRouter needs an API key", "off");
  const key = o.apiKey;
  const model = o.model || DEFAULT_TRANSLATE_MODEL;
  const url = o.url ?? OPENROUTER_CHAT_URL;
  const cache = lruCache<Translation>(o.cacheSize ?? 200);
  const run = limiter(o.concurrency ?? 2);
  const redact = redactor(key);
  const fail = failWith(redact);

  const attempt = (input: TranslateInput, timeoutMs: number): Promise<Translation> =>
    postJson<ChatBody, Translation>({
      url, fetch: o.fetch, timeoutMs, label: "OpenRouter", redact,
      headers: openRouterHeaders(key, o.title),
      body: {
        model,
        messages: [{ role: "system", content: TRANSLATE_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(translatePayload(input)) }],
        max_tokens: o.maxTokens ?? 800,
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
      const base = {
        model: typeof body!.model === "string" ? body!.model : model,
        usage: { input_tokens: num(u?.prompt_tokens) ? u.prompt_tokens : 0, output_tokens: num(u?.completion_tokens) ? u.completion_tokens : 0 },
        raw: redact(content),
      };
      const parsed = parseTranslation(content);
      return "error" in parsed ? { ...base, provider: "error", error: parsed.error } : { ...base, provider: "openrouter", ...parsed };
    });

  async function translate(input: TranslateInput, opts: AskOptions = {}): Promise<Translation> {
    const cacheKey = opts.cacheKey ?? translateCacheKey(input, model);
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const { timeoutMs = o.timeoutMs ?? 30_000, retries = 2, backoffMs = 250 } = opts;
    try {
      return await run(async () => {
        const out = await withRetries(() => attempt(input, timeoutMs), { retries, backoffMs });
        if (out.provider !== "error") cache.set(cacheKey, out);
        return out;
      });
    } catch (e) {
      const message = e instanceof S1Error ? e.message : String((e as Error)?.message ?? e);
      return { model, provider: "error", error: redact(message).slice(0, 300) };
    }
  }

  return { mode: "http", model, translate };
}

/**
 * A canned, gold-free translator: a question when the route is not confident or the intent is `question`/`unclear`,
 * an answer for `answer`, else an `update` of each target (a `#files:` directive binds the first target's files), else
 * an `add` of the route's kind, else a question.
 * The `add` links to the first target with the first vocabulary relation whose ends fit the two kinds, if any.
 */
export const fakeTranslator = (): Translator => ({
  mode: "fake",
  model: "fake",
  translate: async ({ message, route: r, slice, vocabulary }) => {
    const base = { model: "fake", provider: "fake" };
    const dir = /#files:(\S+)/.exec(message);
    // The `#files:` directive is an instruction to the fake, not part of the change: never echo it.
    const text = message.replace(/\s*#files:\S+/g, "").trim();
    if (r.status !== "confident" || r.intent === "question" || r.intent === "unclear" || r.intent === undefined) {
      return { ...base, question: `[fake] Which part should change for: ${text}` };
    }
    if (r.intent === "answer") return { ...base, answer: `[fake] See ${[...r.target.nodes, ...r.target.related].join(", ") || "the specification"}.` };
    const first = r.target.nodes[0];
    if (first && dir) return { ...base, ops: [{ op: "update", id: first, files: dir[1]!.split(",").filter(Boolean) }] };
    if (first && r.intent !== "add") return { ...base, ops: r.target.nodes.map((id) => ({ op: "update" as const, id, fields: { description: `[fake] ${text}` } })) };
    if (r.target.kind) {
      const kind = r.target.kind;
      const other = first === undefined ? undefined : slice.nodes.find((n) => n.id === first)?.kind;
      const rels = Object.entries(vocabulary?.relations ?? {});
      const out = other === undefined ? undefined : rels.find(([, e]) => e.from.includes(kind) && e.to.includes(other))?.[0];
      const into = other === undefined || out ? undefined : rels.find(([, e]) => e.from.includes(other) && e.to.includes(kind))?.[0];
      const links = out ? [{ rel: out, to: first! }] : into ? [{ rel: into, from: first! }] : [];
      return { ...base, ops: [{ op: "add", kind, title: `[fake] ${text}`.slice(0, 80), ...(links.length && { links }) }] };
    }
    return { ...base, question: `[fake] Which part should change for: ${text}` };
  },
});

export const offTranslator = (): Translator => ({
  mode: "off",
  model: "off",
  translate: async () => ({ model: "off", provider: "off" }),
});

export interface TranslatorEnv {
  FAKE_S1?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_TRANSLATE_MODEL?: string;
  TRANSLATE?: string;
  fetch?: typeof fetch;
}

/** `TRANSLATE=0` turns translation off; then `FAKE_S1=1` gives the fake; then `OPENROUTER_API_KEY` gives OpenRouter; else off. */
export function translatorFromEnv(env: TranslatorEnv): Translator {
  if (env.TRANSLATE === "0") return offTranslator();
  if (env.FAKE_S1 === "1") return fakeTranslator();
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (apiKey) return openRouterTranslator({ apiKey, model: env.OPENROUTER_TRANSLATE_MODEL?.trim() || undefined, fetch: env.fetch });
  return offTranslator();
}
