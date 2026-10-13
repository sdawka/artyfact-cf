import { z } from "zod";
import type { FlagDefinition, OperationalFlag, OperationsWindow } from "../../shared/operations";
import { HttpError } from "../errors";
import { canonicalJson, sha256Hex } from "../util";
import type { OperationsBinding } from "./config";
import { validateFlag } from "./validation";

export interface MetricsTotals { requests: number; invocationErrors: number; p50: number | null; p99: number | null }
export interface OperationsProvider {
  metrics(binding: OperationsBinding, window: OperationsWindow): Promise<MetricsTotals>;
  listFlags(binding: OperationsBinding, cursor?: string): Promise<{ flags: OperationalFlag[]; nextCursor?: string }>;
  flag(binding: OperationsBinding, key: string): Promise<OperationalFlag>;
  createFlag(binding: OperationsBinding, flag: FlagDefinition): Promise<OperationalFlag>;
  updateFlag(binding: OperationsBinding, flag: FlagDefinition): Promise<OperationalFlag>;
}
export class ProviderUnavailable extends Error { constructor(readonly reason = "provider-unavailable") { super("operations provider unavailable"); } }
export type FetchOperations = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const API = "https://api.cloudflare.com/client/v4";
const totalsSchema = z.object({ sum: z.object({ requests: z.number().finite().nonnegative(), errors: z.number().finite().nonnegative() }), quantiles: z.object({ cpuTimeP50: z.number().finite().nonnegative().nullable(), cpuTimeP99: z.number().finite().nonnegative().nullable() }) });
export class CloudflareOperationsProvider implements OperationsProvider {
  constructor(private readonly token: string, private readonly send: FetchOperations = fetch) {}
  private async request(url: string, method = "GET", payload?: unknown): Promise<Record<string, unknown>> {
    if (!this.token) throw new ProviderUnavailable("credentials-unconfigured");
    let response: Response;
    try { response = await this.send(url, { method, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, ...(payload !== undefined && { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(15_000) }); } catch { throw new ProviderUnavailable(); }
    if (response.status === 404) throw new HttpError(404, "flag-not-found", "Flagship flag does not exist");
    if (response.status === 409) throw new HttpError(409, "flag-conflict", "Flagship flag already exists or changed");
    if (!response.ok) throw new ProviderUnavailable(`provider-http-${response.status}`);
    // Bound provider response bytes even when Content-Length is absent or dishonest.
    const reader = response.body?.getReader(); if (!reader) throw new ProviderUnavailable("invalid-provider-response");
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new ProviderUnavailable("provider-response-too-large"); } chunks.push(value); } } catch (e) { if (e instanceof ProviderUnavailable) throw e; throw new ProviderUnavailable(); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ProviderUnavailable("invalid-provider-response"); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProviderUnavailable("invalid-provider-response");
    const obj = raw as Record<string, unknown>;
    if (obj.success === false || (Array.isArray(obj.errors) && obj.errors.length)) throw new ProviderUnavailable();
    return obj;
  }
  async metrics(binding: OperationsBinding, window: OperationsWindow): Promise<MetricsTotals> {
    // No dimensions: one aggregation for the full script/window. Never average bucket percentiles.
    const response = await this.request(`${API}/graphql`, "POST", {
      query: `query OperationsMetrics($accountTag: string, $scriptName: string, $datetimeStart: string, $datetimeEnd: string) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 1, filter: {scriptName: $scriptName, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}) { sum { requests errors } quantiles { cpuTimeP50 cpuTimeP99 } } } } }`,
      variables: { accountTag: binding.accountId, scriptName: binding.scriptName, datetimeStart: window.from, datetimeEnd: window.to },
    });
    const schema = z.object({ data: z.object({ viewer: z.object({ accounts: z.array(z.object({ workersInvocationsAdaptive: z.array(totalsSchema).max(1) })).length(1) }) }) });
    const parsed = schema.safeParse(response);
    if (!parsed.success || !parsed.data.data.viewer.accounts[0]?.workersInvocationsAdaptive.length) throw new ProviderUnavailable("no-analytics-data");
    const row = parsed.data.data.viewer.accounts[0]!.workersInvocationsAdaptive[0]!;
    return { requests: row.sum.requests, invocationErrors: row.sum.errors, p50: row.quantiles.cpuTimeP50, p99: row.quantiles.cpuTimeP99 };
  }
  private flagsUrl(binding: OperationsBinding): string {
    if (!binding.flagshipAppId) throw new ProviderUnavailable("flagship-unconfigured");
    return `${API}/accounts/${encodeURIComponent(binding.accountId)}/flagship/apps/${encodeURIComponent(binding.flagshipAppId)}/flags`;
  }
  private async flagDto(raw: unknown): Promise<OperationalFlag> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProviderUnavailable("invalid-provider-response");
    const obj = raw as Record<string, unknown>;
    let definition: FlagDefinition;
    try { definition = validateFlag(Object.fromEntries(["key", "enabled", "default_variation", "variations", "rules", "description"].filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))); } catch { throw new ProviderUnavailable("invalid-provider-flag"); }
    return { ...definition, version: await sha256Hex(canonicalJson({ ...definition, updated_at: obj.updated_at ?? null })), ...(typeof obj.updated_at === "string" && { updatedAt: obj.updated_at }), ...(["boolean", "string", "number", "json"].includes(String(obj.type)) && { type: obj.type as OperationalFlag["type"] }) };
  }
  async listFlags(binding: OperationsBinding, cursor?: string) {
    const url = new URL(this.flagsUrl(binding)); url.searchParams.set("limit", "200"); if (cursor) url.searchParams.set("cursor", cursor);
    const raw = await this.request(url.toString());
    if (!Array.isArray(raw.result) || raw.result.length > 200) throw new ProviderUnavailable("invalid-provider-response");
    const info = raw.result_info as { cursor?: unknown } | undefined;
    return { flags: await Promise.all(raw.result.map(v => this.flagDto(v))), ...(typeof info?.cursor === "string" && info.cursor && { nextCursor: info.cursor }) };
  }
  async flag(binding: OperationsBinding, key: string) { return this.flagDto((await this.request(`${this.flagsUrl(binding)}/${encodeURIComponent(key)}`)).result); }
  async createFlag(binding: OperationsBinding, flag: FlagDefinition) { return this.flagDto((await this.request(this.flagsUrl(binding), "POST", flag)).result); }
  async updateFlag(binding: OperationsBinding, flag: FlagDefinition) { return this.flagDto((await this.request(`${this.flagsUrl(binding)}/${encodeURIComponent(flag.key)}`, "PUT", flag)).result); }
}
