import { CliError } from "./git.ts";
import { assertBearerTransport } from "./platform-url.ts";

/** A non-2xx platform response: HTTP status plus the `{error:{code,message,details}}` body when there is one. */
export class PlatformError extends CliError {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;
  /** The server's message alone, without the method, path and status. */
  readonly detail: string | undefined;
  constructor(message: string, status: number, code?: string, details?: unknown, detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.detail = detail;
  }
}

export class PlatformClient {
  readonly base: string;
  readonly #secret: string | undefined;

  /** `secret` is the realization secret, sent as a bearer token on every call. */
  constructor(base: string, secret?: string) {
    if (secret) assertBearerTransport(base, "the realization secret");
    this.base = base;
    this.#secret = secret;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.base.replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(this.#secret && { authorization: `Bearer ${this.#secret}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new CliError(`cannot reach platform at ${this.base}: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      let code: string | undefined, details: unknown, message: string | undefined;
      try {
        const j = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } };
        if (j.error) {
          ({ code, details, message } = j.error);
          detail = `${j.error.code ?? "error"}: ${j.error.message ?? ""}`;
        }
      } catch {
        /* keep raw text */
      }
      throw new PlatformError(`${method} ${path} -> ${res.status} ${detail}`.trim(), res.status, code, details, message);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Route builder: `/api/systems/:sid/evolutions/:eid/realizations/:rid/...` (backend.md B.7). */
export const rzPath = (systemId: string, evolutionId: string, rid: string, tail = "") =>
  `/api/systems/${encodeURIComponent(systemId)}/evolutions/${encodeURIComponent(evolutionId)}/realizations/${encodeURIComponent(rid)}${tail}`;
