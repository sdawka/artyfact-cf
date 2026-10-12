import { spawnSync } from "node:child_process";

export class CliError extends Error {}

export function git(cwd: string, args: string[], token?: string): string {
  const full = token ? ["-c", `http.extraHeader=Authorization: Bearer ${token}`, ...args] : args;
  const r = spawnSync("git", full, { cwd, encoding: "utf8" });
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
    git(cwd, ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost", "commit", "-m", message]);
  }
  return git(cwd, ["rev-parse", "HEAD"]);
}
