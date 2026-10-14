/**
 * One shell word for a server-supplied value in a copied command: unchanged when it is plainly safe, otherwise POSIX
 * single-quoted (`'` becomes `'\''`), so ids with `;`, `$(…)`, backticks, quotes or newlines cannot run anything.
 */
export function shellArg(s: string): string {
  return /^[A-Za-z0-9._:@\/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}
