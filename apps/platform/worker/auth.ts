import type { MiddlewareHandler } from "hono";
import { HttpError } from "./errors";

const enc = new TextEncoder();

/** Constant-time comparison of two strings via SHA-256 digests (length-independent). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

/**
 * `Authorization: Bearer <ADMIN_TOKEN>` for admin routes. Fails closed when the secret is unset.
 * 401 `unauthorized` when no bearer token is sent, 403 `forbidden` when it does not match.
 */
export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) throw new HttpError(503, "admin-unconfigured", "ADMIN_TOKEN is not configured");
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m) throw new HttpError(401, "unauthorized", "admin bearer token required");
  if (!(await safeEqual(m[1].trim(), expected))) throw new HttpError(403, "forbidden", "admin bearer token does not match");
  await next();
};
