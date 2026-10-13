/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Node-only: every YAML file under `root` as a relative path -> text map, for `loadArtyfactSystem` and `loadArtyfactTemplate`. */
export function readDir(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(name)) out[relative(root, p).split("\\").join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(root);
  return out;
}
