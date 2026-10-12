import { Hono } from "hono";
import type { Env } from "../env";

interface ContactRow {
  id: string;
  owner_account_id: string;
  display_name: string;
  channels_json: string;
  linked_account_id: string | null;
  version: number;
  created_at: string;
}

export const contacts = new Hono<{ Bindings: Env }>();

// Owner identity is stubbed with a header until real auth lands.
const owner = (h: string | undefined) => h || "anonymous";

contacts.get("/", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM contact_records WHERE owner_account_id = ? ORDER BY display_name")
    .bind(owner(c.req.header("x-owner")))
    .all<ContactRow>();
  return c.json({ contacts: results.map((r) => ({ ...r, channels: JSON.parse(r.channels_json) })) });
});

contacts.post("/", async (c) => {
  const body = await c.req.json<{ displayName?: string; channels?: unknown[] }>().catch(() => ({}) as { displayName?: string; channels?: unknown[] });
  if (!body.displayName?.trim()) return c.json({ error: { code: "invalid", message: "displayName required" } }, 400);
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare("INSERT INTO contact_records (id, owner_account_id, display_name, channels_json, version, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .bind(id, owner(c.req.header("x-owner")), body.displayName.trim(), JSON.stringify(body.channels ?? []), new Date().toISOString())
    .run();
  return c.json({ id, displayName: body.displayName.trim(), version: 1 }, 201);
});
