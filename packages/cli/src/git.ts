import { spawnSync } from "node:child_process";

export class CliError extends Error {}

/** Passes the bearer header via the environment so the token never appears in argv (visible to `ps`). */
export function gitEnv(token?: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!token) return { ...base };
  const n = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  return {
    ...base,
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: "http.extraHeader",
    [`GIT_CONFIG_VALUE_${n}`]: `Authorization: Bearer ${token}`,
  };
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

/** Ids end up in URLs and git argv; reject anything that could be read as an option or path. */
export function assertId(kind: string, v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v) || v.startsWith("-") || v === "." || v === "..")
    throw new CliError(`invalid ${kind}: ${JSON.stringify(v)}`);
  return v;
}

export function assertHttpsUrl(kind: string, v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("https://") || /\s/.test(v)) throw new CliError(`invalid ${kind}: must be an https:// URL`);
  try { new URL(v); } catch { throw new CliError(`invalid ${kind}: must be an https:// URL`); }
  return v;
}

export function git(cwd: string, args: string[], token?: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv(token) });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").replaceAll(token ?? "\0", "***").trim();
    throw new CliError(`git ${args[0]} failed: ${msg}`);
  }
  return r.stdout.trim();
}

export function isDirty(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain"]) !== "";
}

/** Stage everything and commit when the tree is dirty; returns HEAD sha. */
export function commitIfDirty(cwd: string, message: string): string {
  if (isDirty(cwd)) {
    git(cwd, ["add", "-A"]);
    git(cwd, ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost", "commit", "-m", message, "--"]);
  }
  return git(cwd, ["rev-parse", "HEAD"]);
}
