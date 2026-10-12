import type { MiddlewareHandler } from "hono";
import { HttpError } from "./errors";
import { sha256Hex } from "./util";

const enc = new TextEncoder();

/** Constant-time comparison of two strings via SHA-256 digests (length-independent). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
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

export const bearer = (header: string | undefined) => /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1].trim();

/**
 * A realization's agent routes (checkpoint, submit, sync, GET status and packet): `Authorization: Bearer <secret>`
 * where SHA-256(secret) is the hash stored with the realization at start, or the admin bearer. Both compared in
 * constant time. 401 when no bearer token is sent. The secret is checked before anything is resolved: `holders`
 * lists the Systems that may hold the realization with their stored hashes, and the match names the System. A
 * token that matches none (wrong, revoked, another realization's, or an unknown realization) is 403, so a non-admin
 * caller never learns whether or where the realization exists.
 */
export async function requireRealizationSecret(
  env: Env, authorization: string | undefined, holders: () => Promise<{ systemId: string; hash: string | null }[]>,
): Promise<{ admin: true } | { admin: false; systemId: string }> {
  const token = bearer(authorization);
  if (!token) throw new HttpError(401, "unauthorized", "realization secret (or admin bearer token) required");
  if (env.ADMIN_TOKEN && (await safeEqual(token, env.ADMIN_TOKEN))) return { admin: true };
  const digest = await sha256Hex(token);
  for (const h of await holders()) {
    if (h.hash && (await safeEqual(digest, h.hash))) return { admin: false, systemId: h.systemId };
  }
  throw new HttpError(403, "forbidden", "realization secret does not match");
}

/** 32 random bytes as hex: the per-realization secret handed to the agent once, at start. */
export function newRealizationSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
