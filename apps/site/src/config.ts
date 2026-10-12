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
