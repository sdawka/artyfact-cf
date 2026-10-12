import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";

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
