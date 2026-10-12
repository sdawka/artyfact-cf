/**
 * Which platform the CLI talks to. An explicit `--platform`, `ARTYFACT_PLATFORM` or `ARTYFACT_URL` is used as given.
 * Otherwise the local default is http://localhost:1337; Vite moves to the next free port when 1337 is taken, so the
 * CLI asks the next few ports for the platform's health route and uses the first that answers as artyfact.
 */
import { CliError } from "./git.ts";

export const DEFAULT_PORT = 1337;
export const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}`;
const PROBE_PORTS = 10;

export async function resolvePlatform(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
  fetchFn: typeof fetch = fetch,
  note: (s: string) => void = () => {},
): Promise<string> {
  const given = explicit ?? env.ARTYFACT_PLATFORM ?? env.ARTYFACT_URL;
  if (given) return given.replace(/\/$/, "");
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PROBE_PORTS; port++) {
    const url = `http://localhost:${port}`;
    if (await isPlatform(url, fetchFn)) {
      if (port !== DEFAULT_PORT) note(`platform found at ${url} (port ${DEFAULT_PORT} is taken by something else)`);
      return url;
    }
  }
  return DEFAULT_URL;
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
