import { createMiddleware } from "hono/factory";
import type { Env } from "./env";

export type AuthVars = { accountId: string };

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s)));

/** Verify a Cloudflare Access JWT (RS256) against the team's JWKS; returns the `sub` claim or null. */
export async function verifyAccessJwt(token: string, env: Env): Promise<string | null> {
  try {
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return null;
    const header = json(h);
    const claims = json(p);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (header.alg !== "RS256" || !aud.includes(env.ACCESS_AUD)) return null;
    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}` || !(claims.exp > Date.now() / 1000) || !claims.sub) return null;
    const jwks = (await (await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)).json()) as { keys: (JsonWebKey & { kid: string })[] };
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(sig), new TextEncoder().encode(`${h}.${p}`));
    return ok ? String(claims.sub) : null;
  } catch {
    return null;
  }
}

/**
 * Sets `accountId` from a verified identity or answers 401. Implements the Genome's provisional `policy.authentication`.
 * Deployed: Cloudflare Access (ACCESS_AUD + ACCESS_TEAM_DOMAIN). Local/tests only: `x-owner` when DEV_AUTH_HEADER=1.
 */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
  let id: string | null = null;
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN) {
    if (jwt) id = await verifyAccessJwt(jwt, c.env);
  } else if (c.env.DEV_AUTH_HEADER === "1") id = c.req.header("x-owner")?.trim() || null;
  if (!id) return c.json({ error: { code: "unauthorized", message: "authentication required" } }, 401);
  c.set("accountId", id);
  await next();
});
