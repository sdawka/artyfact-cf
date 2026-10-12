import { DurableObject } from "cloudflare:workers";

/** One instance per System. Placeholder until slice 1 (SQLite schema + RPC). */
export class SystemAuthority extends DurableObject<Env> {}
