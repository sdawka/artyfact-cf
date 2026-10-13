import { S1Error } from "./provider.ts";

/** Shared plumbing for keyed HTTP providers: timeouts, retries, redaction, an LRU cache and a concurrency limiter. */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A minimal FIFO semaphore: at most `n` calls of the returned runner are in flight. */
export function limiter(n: number) {
  const cap = Math.max(1, n);
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(f: () => Promise<T>): Promise<T> => {
    if (active >= cap) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await f(); } finally { active--; queue.shift()?.(); }
  };
}

/** A least-recently-used cache over a `Map`; a hit moves the entry to the back. */
export function lruCache<V>(size: number) {
  const map = new Map<string, V>();
  return {
    get(key: string): V | undefined {
      const hit = map.get(key);
      if (hit !== undefined) { map.delete(key); map.set(key, hit); }
      return hit;
    },
    set(key: string, value: V): void {
      map.set(key, value);
      if (map.size > size) map.delete(map.keys().next().value!);
    },
    get size() { return map.size; },
  };
}

/** Replaces every occurrence of `secret` with `[redacted]`. */
export const redactor = (secret: string) => (s: string): string => (secret ? s.split(secret).join("[redacted]") : s);

/** An `S1Error` whose message is redacted and capped at 300 characters. */
export const failWith = (redact: (s: string) => string) =>
  (message: string, code: S1Error["code"], status?: number) => new S1Error(redact(message).slice(0, 300), code, status);

export interface PostOptions {
  url: string;
  body: unknown;
  headers: Record<string, string>;
  timeoutMs: number;
  fetch?: typeof fetch;
  /** Prefix for timeout and network error messages, e.g. `OpenRouter`. */
  label: string;
  redact: (s: string) => string;
}

export interface PostResult<B> { res: Response; text: string; body: B | undefined }

/**
 * POSTs JSON with an abort timeout and reads the body as text, then JSON when it parses. Timeouts and network
 * failures become redacted `S1Error`s; an `S1Error` thrown by `check` passes through. HTTP status is left to `check`.
 */
export async function postJson<B, R>(o: PostOptions, check: (r: PostResult<B>) => R): Promise<R> {
  const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
  const fail = failWith(o.redact);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
  try {
    const res = await doFetch(o.url, { method: "POST", headers: o.headers, body: JSON.stringify(o.body), signal: ctl.signal });
    const text = await res.text();
    let body: B | undefined;
    try { body = JSON.parse(text) as B; } catch { body = undefined; }
    return check({ res, text, body });
  } catch (e) {
    if (e instanceof S1Error) throw e;
    if (ctl.signal.aborted) throw fail(`${o.label} timed out after ${o.timeoutMs} ms`, "timeout");
    throw fail(`${o.label} network error: ${(e as Error)?.message ?? e}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Timeouts, 429 and 5xx are worth another attempt. */
export const retryable = (e: S1Error) => e.code === "timeout" || (e.code === "http" && (e.status === 429 || (e.status ?? 0) >= 500));

export interface RetryOptions { retries: number; backoffMs: number; isRetryable?: (e: S1Error) => boolean }

/** Runs `f` up to `retries + 1` times with exponential backoff; a 429 waits at least one second before doubling. */
export async function withRetries<T>(f: () => Promise<T>, o: RetryOptions): Promise<T> {
  const ok = o.isRetryable ?? retryable;
  for (let n = 0; ; n++) {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof S1Error) || !ok(e) || n >= o.retries) throw e;
      const rateLimited = e.code === "http" && e.status === 429;
      await sleep((rateLimited ? Math.max(o.backoffMs, 1000) : o.backoffMs) * 2 ** n);
    }
  }
}

/** Standard OpenRouter request headers; the key appears only in `Authorization`. */
export const openRouterHeaders = (key: string, title?: string): Record<string, string> => ({
  Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": title ?? "artyfact ontology",
});
