import { CliError } from "./git.ts";

export class PlatformClient {
  constructor(readonly base: string) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.base.replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new CliError(`cannot reach platform at ${this.base}: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
        if (j.error) detail = `${j.error.code ?? "error"}: ${j.error.message ?? ""}`;
      } catch {
        /* keep raw text */
      }
      throw new CliError(`${method} ${path} -> ${res.status} ${detail}`.trim());
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** Route builder: `/api/systems/:sid/realizations/:rid/...` (backend.md B.7). */
export const rzPath = (systemId: string, rid: string, tail = "") =>
  `/api/systems/${encodeURIComponent(systemId)}/realizations/${encodeURIComponent(rid)}${tail}`;
