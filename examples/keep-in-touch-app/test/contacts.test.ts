import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { clearJwksCache } from "../src/worker/auth";

const E = env as unknown as { DB: D1Database };
const call = (path: string, init: RequestInit = {}, vars: Record<string, string> = { DEV_AUTH_HEADER: "1" }) =>
  app.fetch(new Request(`http://x${path}`, init), { DB: E.DB, ...vars });
const post = (owner: string | null, name: string) =>
  call("/api/contacts", { method: "POST", headers: { "content-type": "application/json", ...(owner ? { "x-owner": owner } : {}) }, body: JSON.stringify({ displayName: name }) });

beforeAll(async () => {
  await E.DB.exec("CREATE TABLE IF NOT EXISTS contact_records (id TEXT PRIMARY KEY, owner_account_id TEXT NOT NULL, display_name TEXT NOT NULL, channels_json TEXT NOT NULL DEFAULT '[]', linked_account_id TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)");
});

describe("contacts auth", () => {
  it("returns 401 without identity", async () => {
    expect((await call("/api/contacts")).status).toBe(401);
    expect((await post(null, "x")).status).toBe(401);
  });

  it("honours x-owner only when DEV_AUTH_HEADER=1", async () => {
    const h = { headers: { "x-owner": "alice" } };
    expect((await call("/api/contacts", h, {})).status).toBe(401);
    expect((await call("/api/contacts", h, { DEV_AUTH_HEADER: "0" })).status).toBe(401);
    expect((await call("/api/contacts", h)).status).toBe(200);
  });

  it("ignores x-owner and rejects bad JWTs when Access is configured", async () => {
    const access = { ACCESS_AUD: "aud", ACCESS_TEAM_DOMAIN: "t.example", DEV_AUTH_HEADER: "1" };
    expect((await call("/api/contacts", { headers: { "x-owner": "alice" } }, access)).status).toBe(401);
    expect((await call("/api/contacts", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } }, access)).status).toBe(401);
  });

  it("isolates owners", async () => {
    expect((await post("alice", "Ann")).status).toBe(201);
    expect((await post("bob", "Bo")).status).toBe(201);
    const names = async (o: string) =>
      ((await (await call("/api/contacts", { headers: { "x-owner": o } })).json()) as { contacts: { display_name: string }[] }).contacts.map((c) => c.display_name);
    expect(await names("alice")).toEqual(["Ann"]);
    expect(await names("bob")).toEqual(["Bo"]);
    expect(await names("carol")).toEqual([]);
  });
});

describe("Access JWT verification", () => {
  const DOMAIN = "team.example.com";
  const access = { ACCESS_AUD: "aud-1", ACCESS_TEAM_DOMAIN: DOMAIN };
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let pair: CryptoKeyPair;
  let jwk: JsonWebKey;
  let fetches = 0;

  beforeAll(async () => {
    pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" } as JsonWebKey & { kid: string };
  });
  afterEach(() => { vi.unstubAllGlobals(); clearJwksCache(); fetches = 0; });

  const stubJwks = (ok = true) =>
    vi.stubGlobal("fetch", async () => { fetches++; return ok ? Response.json({ keys: [jwk] }) : new Response("no", { status: 503 }); });
  const sign = async (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    const body = `${enc({ alg: "RS256", kid: "k1" })}.${enc({ iss: `https://${DOMAIN}`, aud: ["aud-1"], sub: "user-1", exp: now + 300, ...claims })}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${b64u(sig)}`;
  };
  const withJwt = (t: string, vars: Record<string, string> = access) =>
    call("/api/contacts", { headers: { "Cf-Access-Jwt-Assertion": t } }, vars);

  it("accepts a valid token and scopes rows to its sub", async () => {
    stubJwks();
    const t = await sign({});
    const created = await call("/api/contacts", { method: "POST", headers: { "Cf-Access-Jwt-Assertion": t, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Jwt Person" }) }, access);
    expect(created.status).toBe(201);
    const list = (await (await withJwt(t)).json()) as { contacts: { owner_account_id: string }[] };
    expect(list.contacts.map((c) => c.owner_account_id)).toEqual(["user-1"]);
    expect(fetches).toBe(1);
  });

  it("caches the JWKS", async () => {
    stubJwks();
    const t = await sign({});
    await withJwt(t);
    await withJwt(t);
    expect(fetches).toBe(1);
  });

  it("rejects wrong aud, expired, not-yet-valid and tampered tokens", async () => {
    stubJwks();
    const now = Math.floor(Date.now() / 1000);
    expect((await withJwt(await sign({ aud: ["other"] }))).status).toBe(401);
    expect((await withJwt(await sign({ exp: now - 10 }))).status).toBe(401);
    expect((await withJwt(await sign({ nbf: now + 600 }))).status).toBe(401);
    const good = await sign({});
    const [h, , sig] = good.split(".");
    expect((await withJwt(`${h}.${enc({ iss: `https://${DOMAIN}`, aud: ["aud-1"], sub: "admin", exp: now + 300 })}.${sig}`)).status).toBe(401);
  });

  it("fails closed when the JWKS fetch fails", async () => {
    stubJwks(false);
    expect((await withJwt(await sign({}))).status).toBe(401);
  });

  it("partial Access config never falls back to the dev header", async () => {
    for (const vars of [{ ACCESS_AUD: "a" }, { ACCESS_TEAM_DOMAIN: DOMAIN }] as Record<string, string>[]) {
      const r = await call("/api/contacts", { headers: { "x-owner": "alice" } }, { ...vars, DEV_AUTH_HEADER: "1" });
      expect(r.status).toBe(401);
    }
  });
});
