/**
 * Planners that split an Evolution into Tasks (backend.md B.9). Mirrors `packages/ontology/src/route/translate.ts`:
 * a system prompt, a reply schema, an OpenRouter planner at temperature 0 (no cache: a planner is built per request), a fake for `FAKE_S1=1`, an off planner and
 * `plannerFromEnv`. A planner never throws: failures come back as `{ error }`; `planner.ts` validates every reply and
 * falls back to the deterministic plan when there is none.
 */
import { DEFAULT_TRANSLATE_MODEL, OPENROUTER_CHAT_URL } from "@artyfact/ontology";
import { z } from "zod";

/** The translator's default model. */
export const DEFAULT_PLAN_MODEL = DEFAULT_TRANSLATE_MODEL;

export const PLAN_SYSTEM_PROMPT = [
  "You split one change (an Evolution) of a specified software system into Tasks that separate coding agents do in parallel.",
  "You get the Evolution (id, title, intent, its acceptance criteria), an optional hint from the user, and each affected",
  "node of the specification: id, kind, title, path from the System root, the Thing it belongs to, its nearest section,",
  "the source files it maps to, its outgoing links, the criteria about it and its one-hop neighbours.",
  "Reply with exactly one JSON object and nothing else:",
  '{"tasks":[{"title":T,"intent":I,"nodes":[ID,...],"dependsOn":[T,...],"acceptanceCriteria":[CID,...]}]}',
  "Rules: every affected node belongs to exactly one task; a task's nodes all belong to the same Thing (or all to none);",
  "use only the given node ids and criterion ids; dependsOn names other tasks of your reply by title and must not form a cycle;",
  "a task depends on another when it calls, invokes, reads or uses what the other builds.",
  "Prefer few tasks whose files do not overlap: nodes that share source files belong together.",
  "Titles are short imperative phrases; the intent says what the agent must make true, in one or two sentences.",
].join("\n");

const id = z.string().min(1);
export const PlanReplySchema = z.object({
  tasks: z.array(z.object({
    // Capped: titles and intents flow into task packets.
    title: z.string().min(1).transform((x) => x.slice(0, 200)),
    intent: z.string().default("").transform((x) => x.slice(0, 2000)),
    nodes: z.array(id).min(1),
    dependsOn: z.array(z.string()).default([]),
    acceptanceCriteria: z.array(id).default([]),
  })).min(1),
});
export type PlanReplyTask = z.infer<typeof PlanReplySchema>["tasks"][number];

/** One affected node as the planner sees it. */
export interface PlanNodeContext {
  id: string;
  kind: string;
  title: string;
  path: string[];
  /** The Thing on the node's path; null for System-level nodes. */
  thing: string | null;
  /** The nearest section at or above the node. */
  section: string | null;
  files: string[];
  linksOut: { rel: string; to: string }[];
  criteria: string[];
  neighbours: string[];
}

export interface PlanContext {
  evolution: { id: string; title: string; intent: string; kind?: string; acceptanceCriteria: { id: string; claim: string; subject: string }[] };
  nodes: PlanNodeContext[];
  hint?: string;
}

/** `tasks` on success; `error` (with `raw` when there was a reply) otherwise. Off planners return neither. */
export interface PlanReply {
  provider: string;
  model: string;
  tasks?: PlanReplyTask[];
  error?: string;
  raw?: string;
}

export interface Planner {
  mode: "http" | "fake" | "off";
  model: string;
  plan(ctx: PlanContext): Promise<PlanReply>;
}

/** Parses a model reply: one JSON object, optionally inside a single code fence. */
export function parsePlanReply(text: string): { tasks: PlanReplyTask[] } | { error: string } {
  const body = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1").trim();
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { error: "planner reply is not JSON" }; }
  const r = PlanReplySchema.safeParse(json);
  if (!r.success) return { error: `planner reply does not fit the schema: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 200)}` };
  return r.data;
}

export interface OpenRouterPlannerOptions {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Attempts after the first on network errors, 429 and 5xx. Default 1. */
  retries?: number;
  /** Wait before retry k is `backoffMs * k`. Default 1000. */
  backoffMs?: number;
  maxTokens?: number;
}

interface ChatBody { model?: string; choices?: { message?: { content?: unknown } }[]; error?: { code?: number | string; message?: string } }

/** OpenRouter chat completions as a {@link Planner}. The key goes only in `Authorization` and is redacted from errors. */
export function openRouterPlanner(o: OpenRouterPlannerOptions): Planner {
  const key = o.apiKey;
  const model = o.model || DEFAULT_PLAN_MODEL;
  const url = o.url ?? OPENROUTER_CHAT_URL;
  const redact = (s: string) => (key ? s.split(key).join("[redacted]") : s);

  async function attempt(ctx: PlanContext): Promise<PlanReply & { retry?: boolean }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 45_000);
    try {
      const res = await (o.fetch ?? fetch)(url, {
        method: "POST",
        signal: ac.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "artyfact planner" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: PLAN_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(ctx) }],
          max_tokens: o.maxTokens ?? 2000,
          temperature: 0,
        }),
      });
      const text = await res.text();
      let body: ChatBody | undefined;
      try { body = JSON.parse(text) as ChatBody; } catch { body = undefined; }
      if (!res.ok || body?.error) {
        const status = res.ok ? Number(body?.error?.code) || 502 : res.status;
        return { provider: "error", model, error: redact(`OpenRouter HTTP ${status}${body?.error?.message ? `: ${body.error.message}` : ""}`).slice(0, 300), retry: status === 429 || status >= 500 };
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") return { provider: "error", model, error: "OpenRouter: malformed chat response" };
      const used = typeof body?.model === "string" ? body.model : model;
      const parsed = parsePlanReply(content);
      return "error" in parsed
        ? { provider: "error", model: used, error: parsed.error, raw: redact(content).slice(0, 4000) }
        : { provider: "openrouter", model: used, tasks: parsed.tasks };
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      return { provider: "error", model, error: redact(aborted ? "OpenRouter: timed out" : `OpenRouter: ${String((e as Error)?.message ?? e)}`).slice(0, 300), retry: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    mode: "http",
    model,
    async plan(ctx) {
      let out = await attempt(ctx);
      for (let k = 1; k <= (o.retries ?? 1) && out.retry; k++) {
        await new Promise((r) => setTimeout(r, (o.backoffMs ?? 1000) * k));
        out = await attempt(ctx);
      }
      const { retry: _r, ...reply } = out;
      return reply;
    },
  };
}

/** `#plan:split` and `#plan:dep` in the hint or the Evolution's intent. */
export const planDirectives = (ctx: PlanContext) => {
  const text = `${ctx.hint ?? ""}\n${ctx.evolution.intent}`;
  return { split: /#plan:split\b/.test(text), dep: /#plan:dep\b/.test(text) };
};

/**
 * A canned, deterministic planner: one task per (Thing, section) of the affected nodes, in node order. `#plan:split`
 * gives one task per node; `#plan:dep` makes each task depend on the one before it. Criteria are the Evolution's
 * criteria about the task's nodes.
 */
export const fakePlanner = (): Planner => ({
  mode: "fake",
  model: "fake",
  plan: async (ctx) => {
    const { split, dep } = planDirectives(ctx);
    const groups = new Map<string, PlanNodeContext[]>();
    for (const n of ctx.nodes) {
      const key = split ? n.id : `${n.thing ?? ""}|${n.section ?? n.thing ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    const titled = [...groups.values()].map((ns, i) => ({ ns, title: `[fake] ${i + 1}. ${ns.map((n) => n.title).join(", ")}`.slice(0, 120) }));
    const tasks: PlanReplyTask[] = titled.map(({ ns, title }, i) => {
      const ids = new Set(ns.map((n) => n.id));
      return {
        title,
        intent: `[fake] ${ctx.evolution.intent}`.slice(0, 400),
        nodes: ns.map((n) => n.id),
        dependsOn: dep && i > 0 ? [titled[i - 1].title] : [],
        acceptanceCriteria: ctx.evolution.acceptanceCriteria.filter((c) => ids.has(c.subject)).map((c) => c.id),
      };
    });
    return { provider: "fake", model: "fake", tasks };
  },
});

export const offPlanner = (): Planner => ({ mode: "off", model: "off", plan: async () => ({ provider: "off", model: "off" }) });

export interface PlannerEnv {
  TRANSLATE?: string;
  FAKE_S1?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_PLAN_MODEL?: string;
  OPENROUTER_TRANSLATE_MODEL?: string;
}

let override: Planner | undefined;
/** Test hook: plan with this planner instead of the env's (undefined restores the env). */
export function setPlannerOverride(p: Planner | undefined): void {
  override = p;
}

/**
 * `TRANSLATE=0` turns the LLM planner off; then `FAKE_S1=1` gives the fake; then `OPENROUTER_API_KEY` gives OpenRouter
 * (`OPENROUTER_PLAN_MODEL`, else `OPENROUTER_TRANSLATE_MODEL`, else the default); else off. Off plans with the fallback.
 */
export function plannerFromEnv(env: PlannerEnv, fetchImpl?: typeof fetch): Planner {
  if (override) return override;
  if (env.TRANSLATE === "0") return offPlanner();
  if (env.FAKE_S1 === "1") return fakePlanner();
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (apiKey) return openRouterPlanner({ apiKey, model: env.OPENROUTER_PLAN_MODEL?.trim() || env.OPENROUTER_TRANSLATE_MODEL?.trim() || undefined, fetch: fetchImpl });
  return offPlanner();
}
