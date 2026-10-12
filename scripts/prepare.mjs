// Points git at the committed hooks. Quiet no-op outside a git checkout or under CI.
// core.hooksPath is relative, so each worktree resolves .githooks against its own root.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

if (process.env.CI === "true" || process.env.CI === "1") process.exit(0);
try {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (realpathSync(top) !== realpathSync(process.cwd())) process.exit(0);
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // not a git checkout
}
