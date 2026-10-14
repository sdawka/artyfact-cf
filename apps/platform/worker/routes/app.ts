import type { Context } from "hono";
import { badRequest, HttpError } from "../errors";

export type AppEnv = { Bindings: Env };
export type Ctx = Context<AppEnv>;

/** Parse a JSON body; empty body → {}. With `maxBytes`, a larger body is 413 before it is parsed. */
export async function body(c: Ctx, maxBytes?: number): Promise<Record<string, unknown>> {
  const tooLarge = () => new HttpError(413, "payload-too-large", `request body is over ${maxBytes} bytes`);
  if (maxBytes !== undefined && Number(c.req.header("content-length") ?? 0) > maxBytes) throw tooLarge();
  const text = await c.req.text();
  if (maxBytes !== undefined && text.length > maxBytes) throw tooLarge();
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
