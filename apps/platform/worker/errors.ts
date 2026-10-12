import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad-request", message, details);
export const notFound = (message: string) => new HttpError(404, "not-found", message);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new HttpError(422, code, message, details);

/** Map an error thrown across DO RPC (`[code] message`, see ConflictError) to an HttpError. */
export function fromRpc(e: unknown): HttpError | undefined {
  const m = /^\[(not-found|invalid-state)\] (.*)$/s.exec((e as Error)?.message ?? "");
  if (!m) return undefined;
  return m[1] === "not-found" ? notFound(m[2]) : conflict(m[1], m[2]);
}
