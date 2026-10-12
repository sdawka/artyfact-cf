export const DEFAULT_PLATFORM_URL = 'https://artyfact-platform.dawka.workers.dev';
export const DEFAULT_SOURCE_URL = 'https://github.com/sdawka/artyfact-cf';
function publicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? value : null;
  } catch { return null; }
}
export function platformLink(config: { ready: boolean; url: string }): string | null {
  if (!config.ready) return null;
  return config.url === '/app' ? config.url : publicUrl(config.url);
}
export function sourceLink(url: string): string | null { return publicUrl(url); }
/** Build-time settings. Defaults point at the public repository and the hosted demo; env values override them. */
export function resolveSiteConfig(env: Record<string, string | undefined>): { platform: string | null; source: string | null } {
  const ready = env.SITE_PLATFORM_READY !== 'false';
  const platform = platformLink({ ready, url: env.SITE_PLATFORM_URL || DEFAULT_PLATFORM_URL });
  if (ready && !platform) throw new Error('Invalid public platform URL');
  const sourceUrl = env.SITE_SOURCE_URL ?? DEFAULT_SOURCE_URL;
  const source = sourceUrl ? sourceLink(sourceUrl) : null;
  if (sourceUrl && !source) throw new Error('Invalid public source URL');
  return { platform, source };
}
