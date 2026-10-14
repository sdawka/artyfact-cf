import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadGenome, type SystemModel } from '@artyfact/model';
import { metaTemplates } from '@artyfact/templates';

/** The repository's own genome/, found by walking up from `from` (the build runs in apps/site). */
export function findGenomeDir(from = process.cwd()): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'genome', 'node.yaml'))) return join(dir, 'genome');
    if (dirname(dir) === dir) throw new Error('No genome/ directory above ' + from);
  }
}

/** Artyfact's self-Genome, loaded with the same loader and templates the platform uses. Build time only: it reads the file system. */
export function loadSelfGenome(dir = findGenomeDir()): SystemModel {
  const files: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path).split('\\').join('/')] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return loadGenome(files, { templates: metaTemplates });
}
