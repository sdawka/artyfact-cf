/**
 * Which platform the CLI talks to. An explicit `--platform`, `ARTYFACT_PLATFORM` or `ARTYFACT_URL` is used as given.
 * Otherwise the local default is http://localhost:1337; Vite moves to the next free port when 1337 is taken, so the
 * CLI asks the next few ports for the platform's health route and uses the first that answers as artyfact.
 */
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
