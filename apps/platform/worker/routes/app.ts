import type { Context } from "hono";
import { badRequest } from "../errors";

export type AppEnv = { Bindings: Env };
export type Ctx = Context<AppEnv>;

/** Parse a JSON body; empty body → {}. */
export async function body(c: Ctx): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw badRequest("body must be a JSON object");
  }
}

export const origin = (c: Ctx) => new URL(c.req.url).origin;
