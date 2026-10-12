/**
 * Which platform the CLI talks to: an explicit URL (`--platform`, `ARTYFACT_PLATFORM`, `ARTYFACT_URL`; the operator
 * asserted it, so it is never probed or overridden), else the first local port from 1337 whose `/api/health`
 * identifies itself as artyfact (Vite moves to the next free port when 1337 is taken), else an error. There is no
 * silent fallback: credentials never go to a server that did not identify itself.
 */
import { CliError } from "./git.ts";

export const DEFAULT_PORT = 1337;
export const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}`;
const PROBE_PORTS = 10;
const LAST_PORT = DEFAULT_PORT + PROBE_PORTS - 1;

export async function resolvePlatform(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
  note: (s: string) => void = () => {},
): Promise<string> {
  if (explicit !== undefined && !explicit.trim()) throw new CliError("--platform needs a URL");
  // An empty environment variable counts as unset.
  const given = explicit || env.ARTYFACT_PLATFORM || env.ARTYFACT_URL;
  if (given) return given.replace(/\/$/, "");
  for (let port = DEFAULT_PORT; port <= LAST_PORT; port++) {
    const url = `http://localhost:${port}`;
    if (await isPlatform(url, fetchFn)) {
      if (port !== DEFAULT_PORT) note(`platform found at ${url} (port ${DEFAULT_PORT} is taken by something else)`);
      return url;
    }
  }
  throw new CliError(`no artyfact platform found on localhost:${DEFAULT_PORT}–${LAST_PORT}; start it with \`npm run dev\` or pass --platform`);
}

async function isPlatform(base: string, fetchFn: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = res.ok ? ((await res.json()) as { service?: unknown }) : (await res.body?.cancel(), undefined);
    return body?.service === "artyfact-platform";
  } catch {
    return false;
  }
}

/** Bearer credentials (admin token, realization secret) go over https, or plain http to localhost / 127.0.0.1 only. */
export function assertBearerTransport(base: string, what: string): void {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new CliError(`invalid platform URL ${JSON.stringify(base)}`);
  }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return;
  throw new CliError(`refusing to send ${what} to ${u.origin}: use https (plain http only to localhost or 127.0.0.1)`);
}
