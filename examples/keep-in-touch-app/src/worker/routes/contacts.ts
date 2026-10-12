import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../auth";
import type { Env } from "../env";
import { ctxOf, emitPhenome } from "../phenome";

interface ContactRow {
  id: string;
  owner_account_id: string;
  display_name: string;
  channels_json: string;
  linked_account_id: string | null;
  version: number;
  created_at: string;
}

export const contacts = new Hono<{ Bindings: Env; Variables: AuthVars }>();
contacts.use(requireAuth);

contacts.get("/", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT * FROM contact_records WHERE owner_account_id = ? ORDER BY display_name")
    .bind(c.get("accountId"))
    .all<ContactRow>();
  return c.json({ contacts: results.map((r) => ({ ...r, channels: JSON.parse(r.channels_json) })) });
});

contacts.post("/", async (c) => {
  const body = await c.req.json<{ displayName?: string; channels?: unknown[] }>().catch(() => ({}) as { displayName?: string; channels?: unknown[] });
  if (!body.displayName?.trim()) return c.json({ error: { code: "invalid", message: "displayName required" } }, 400);
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare("INSERT INTO contact_records (id, owner_account_id, display_name, channels_json, version, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .bind(id, c.get("accountId"), body.displayName.trim(), JSON.stringify(body.channels ?? []), new Date().toISOString())
    .run();
  emitPhenome(c.env, "contact.saved", { channels: (body.channels ?? []).length }, ctxOf(c), { subject: "contact" });
  return c.json({ id, displayName: body.displayName.trim(), version: 1 }, 201);
});
