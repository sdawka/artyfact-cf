import { CliError } from "./git.ts";

/** The subset of `fetch` the CLI needs, so tests and `Io.fetch` can inject one. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface JsonRequest {
  method: string;
  /** Platform origin; a trailing slash is tolerated. */
  base: string;
  /** Absolute path starting with `/`. */
  path: string;
  /** JSON-serialised when present; no body and no content-type otherwise. */
  body?: unknown;
  /** Sent as `authorization: Bearer ...`. Callers check the transport (`assertBearerTransport`) before passing one. */
  token?: string;
  /** What `base` is, for the unreachable diagnostic: "platform", "Parts catalog". */
  target: string;
}

export interface JsonResponse {
  status: number;
  ok: boolean;
  /** The raw body; callers decide how a non-2xx body becomes an error. */
  text: string;
  /** The decoded body, `{}` when it is empty. Throws `SyntaxError` on malformed JSON. */
  json(): unknown;
}

/** The request never reached the server (DNS, refused, TLS). The message carries the base URL and the cause, never the credential. */
export class UnreachableError extends CliError {
  readonly base: string;
  readonly reason: string;
  constructor(target: string, base: string, reason: string) {
    super(`cannot reach ${target} at ${base}: ${reason}`);
    this.base = base;
    this.reason = reason;
  }
}

/**
 * Builds and sends a JSON/bearer request and reads the body. Endpoint policy stays with the caller: which credential to
 * send, whether to retry without one, and how a non-2xx body maps to an error.
 */
export async function sendJson(fetchImpl: FetchLike | undefined, request: JsonRequest): Promise<JsonResponse> {
  const { method, base, path, body, token, target } = request;
  const url = `${base.replace(/\/$/, "")}${path}`;
  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(url, {
      method,
      headers: {
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new UnreachableError(target, base, (error as Error).message);
  }
  const text = await response.text();
  return { status: response.status, ok: response.ok, text, json: () => (text ? JSON.parse(text) : {}) };
}
